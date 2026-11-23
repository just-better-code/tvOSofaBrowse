#!/usr/bin/env python3
"""Run one stand through Linux tc/netem in a rootless network namespace."""
import argparse
import json
import os
from pathlib import Path
import select
import shutil
import signal
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]

def run(*args):
    subprocess.run(args, check=True)

def ready(fd):
    if not select.select([fd], [], [], 15)[0] or os.read(fd, 1) != b'1':
        raise RuntimeError('Network namespace/helper did not become ready; inspect the private helper log')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download-kbps', type=int, default=2000)
    parser.add_argument('--latency-ms', type=int, default=150, help='Added round-trip latency')
    parser.add_argument('--inner', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--directory', help=argparse.SUPPRESS)
    options, command = parser.parse_known_args()
    if command[:1] == ['--']:
        command = command[1:]
    if not 1 <= options.download_kbps <= 1000000 or not 0 <= options.latency_ms <= 30000:
        parser.error('Download must be 1..1000000 kbit/s; latency must be 0..30000 ms')
    if not command:
        command = [str(ROOT/'scripts/webkit-testbench/webkit-lab.sh'), '--app', '--desktop-vlc', '--ephemeral']
    if options.inner:
        directory = Path(options.directory)
        os.write(int(os.environ['STAND_READY_FD']), b'1')
        if os.read(int(os.environ['STAND_GO_FD']), 1) != b'1':
            return 1
        run('mount', '--bind', str(directory/'resolv.conf'), str(Path('/etc/resolv.conf').resolve()))
        run('ip', 'link', 'set', 'lo', 'up')
        run('ip', 'link', 'add', 'ifb0', 'type', 'ifb')
        run('ip', 'link', 'set', 'ifb0', 'up')
        delay = str(options.latency_ms/2)+'ms'
        run('tc', 'qdisc', 'add', 'dev', 'tap0', 'root', 'netem', 'delay', delay)
        run('tc', 'qdisc', 'add', 'dev', 'tap0', 'handle', 'ffff:', 'ingress')
        run('tc', 'filter', 'add', 'dev', 'tap0', 'parent', 'ffff:', 'protocol', 'all', 'u32',
            'match', 'u32', '0', '0', 'action', 'mirred', 'egress', 'redirect', 'dev', 'ifb0')
        run('tc', 'qdisc', 'add', 'dev', 'ifb0', 'root', 'netem', 'delay', delay, 'rate', str(options.download_kbps)+'kbit')
        # Controlled local fixtures are inside this namespace and use loopback.
        run('tc', 'qdisc', 'add', 'dev', 'lo', 'root', 'netem', 'delay', delay, 'rate', str(options.download_kbps)+'kbit')
        settings = dict(mechanism='Linux tc/netem + rootless slirp4netns', downloadKbps=options.download_kbps,
                        roundTripLatencyMs=options.latency_ms, scope='this stand and child VLC only',
                        loopback='same rate on combined local traffic', evidenceDirectory=str(directory))
        (directory/'settings.json').write_text(json.dumps(settings, indent=2)+'\n')
        print(f"Stand network: {options.download_kbps} kbit/s download, +{options.latency_ms} ms RTT; private evidence: {directory}", flush=True)
        environment = {**os.environ, 'WEBKIT_LAB_NETWORK': json.dumps(settings)}
        try:
            return subprocess.call(command, env=environment)
        finally:
            with (directory/'tc-statistics.txt').open('w') as output:
                subprocess.run(['tc', '-s', 'qdisc', 'show'], stdout=output, check=False)
    helper = shutil.which('slirp4netns') or str(ROOT/'.data/tools/slirp4netns/usr/bin/slirp4netns')
    if not Path(helper).is_file():
        parser.error('Install slirp4netns or extract the distribution package under .data/tools/slirp4netns')
    parent = ROOT/'.data/webkit-testbench/network'
    parent.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix='netem-', dir=parent))
    os.chmod(directory, 0o700)
    (directory/'resolv.conf').write_text('nameserver 10.0.2.3\n')
    read_ready, write_ready = os.pipe()
    read_go, write_go = os.pipe()
    read_slirp, write_slirp = os.pipe()
    read_exit, write_exit = os.pipe()
    child = slirp = None
    try:
        environment = {**os.environ, 'STAND_READY_FD': str(write_ready), 'STAND_GO_FD': str(read_go)}
        child = subprocess.Popen(['unshare', '--user', '--map-current-user', '--mount', '--net', '--keep-caps',
            sys.executable, str(Path(__file__).resolve()), '--inner', '--directory', str(directory),
            '--download-kbps', str(options.download_kbps), '--latency-ms', str(options.latency_ms), '--', *command],
            env=environment, pass_fds=(write_ready, read_go), start_new_session=True)
        os.close(write_ready); write_ready = -1
        ready(read_ready)
        with (directory/'slirp.log').open('w') as log:
            slirp = subprocess.Popen([helper, '--configure', '--disable-host-loopback', '--userns-path', f'/proc/{child.pid}/ns/user',
                '--ready-fd', str(write_slirp), '--exit-fd', str(read_exit), str(child.pid), 'tap0'],
                pass_fds=(write_slirp, read_exit), stdout=log, stderr=log)
        os.close(write_slirp); write_slirp = -1
        ready(read_slirp)
        os.write(write_go, b'1')
        return child.wait()
    finally:
        for fd in (read_ready, write_ready, read_go, write_go, read_slirp, write_slirp, read_exit, write_exit):
            if fd >= 0:
                os.close(fd)
        for process in (child, slirp):
            if process and process.poll() is None:
                if process is child:
                    os.killpg(process.pid, signal.SIGTERM)
                else:
                    process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    if process is child:
                        os.killpg(process.pid, signal.SIGKILL)
                    else:
                        process.kill()
                    process.wait()

if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
