#!/usr/bin/env python3
"""Serve this Proposed method snapshot with HTTP Range support for video seeking."""
import argparse
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()
        if path.endswith('/'):
            self.send_error(404, 'File not found')
            return None
        try:
            handle = open(path, 'rb')
        except OSError:
            self.send_error(404, 'File not found')
            return None
        try:
            stat = os.fstat(handle.fileno())
            length = stat.st_size
            ctype = self.guess_type(path)
            start, end = self._parse_range(self.headers.get('Range'), length)
            if start is False:
                handle.close()
                self.send_error(416, 'Requested Range Not Satisfiable')
                return None
            if start is None:
                self.send_response(200)
                self.send_header('Content-Type', ctype)
                self.send_header('Content-Length', str(length))
                self.send_header('Last-Modified', self.date_time_string(stat.st_mtime))
                self.end_headers()
                self._remaining = None
            else:
                self.send_response(206)
                self.send_header('Content-Type', ctype)
                self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, length))
                self.send_header('Content-Length', str(end - start + 1))
                self.send_header('Last-Modified', self.date_time_string(stat.st_mtime))
                self.end_headers()
                handle.seek(start)
                self._remaining = end - start + 1
            if self.command == 'HEAD':
                handle.close()
                return None
            return handle
        except Exception:
            handle.close()
            raise

    def copyfile(self, source, outputfile):
        remaining = getattr(self, '_remaining', None)
        if remaining is None:
            return super().copyfile(source, outputfile)
        while remaining > 0:
            chunk = source.read(min(65536, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)

    @staticmethod
    def _parse_range(header, length):
        if not header:
            return None, None
        if not header.startswith('bytes='):
            return False, None
        spec = header[6:].strip()
        if ',' in spec or length <= 0:
            return False, None
        start_s, _, end_s = spec.partition('-')
        try:
            if start_s == '':
                suffix = int(end_s)
                if suffix <= 0:
                    return False, None
                start = max(length - suffix, 0)
                end = length - 1
            else:
                start = int(start_s)
                end = int(end_s) if end_s else length - 1
        except ValueError:
            return False, None
        if start < 0 or start >= length or end < start:
            return False, None
        return start, min(end, length - 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8127)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print('Serving %s' % ROOT)
    print('Open http://%s:%s/' % (args.host, args.port))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')


if __name__ == '__main__':
    main()
