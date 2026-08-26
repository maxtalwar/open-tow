from __future__ import annotations

import argparse
import json
import mimetypes
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from .agents import DoctrineAgent, agent_observation
from .engine import OrderError, order_schema, resolve_turn
from .scenario import PROJECT_ROOT, load_scenario, scenario_metadata


STATIC_ROOT = PROJECT_ROOT / "static"


class GameService:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.state = load_scenario()

    def reset(self, seed: int = 7) -> dict[str, Any]:
        with self.lock:
            self.state = load_scenario(seed=seed)
            return self.state.to_dict()

    def human_turn(self, side: str, orders: list[dict[str, Any]]) -> dict[str, Any]:
        if side not in ("BLUE", "RED"):
            raise OrderError("side must be BLUE or RED")
        opponent = "RED" if side == "BLUE" else "BLUE"
        with self.lock:
            bundles = {
                side: orders,
                opponent: DoctrineAgent(opponent).orders(self.state),
            }
            resolve_turn(self.state, bundles)  # type: ignore[arg-type]
            return self.state.to_dict(observer=side)  # type: ignore[arg-type]

    def agent_turn(self) -> dict[str, Any]:
        with self.lock:
            bundles = {
                "BLUE": DoctrineAgent("BLUE").orders(self.state),
                "RED": DoctrineAgent("RED").orders(self.state),
            }
            resolve_turn(self.state, bundles)
            return self.state.to_dict()


SERVICE = GameService()


class Handler(BaseHTTPRequestHandler):
    server_version = "OpenTOW/0.2"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[open-tow] {self.address_string()} {fmt % args}")

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            return self._json({"status": "ok", "version": "0.2.0"})
        if parsed.path == "/api/scenario":
            return self._json(scenario_metadata())
        if parsed.path == "/api/order-schema":
            return self._json(order_schema())
        if parsed.path == "/api/state":
            observer = parse_qs(parsed.query).get("observer", [None])[0]
            if observer not in (None, "BLUE", "RED"):
                return self._error(HTTPStatus.BAD_REQUEST, "observer must be BLUE or RED")
            with SERVICE.lock:
                return self._json(SERVICE.state.to_dict(observer=observer))  # type: ignore[arg-type]
        if parsed.path == "/api/observation":
            side = parse_qs(parsed.query).get("side", ["BLUE"])[0]
            if side not in ("BLUE", "RED"):
                return self._error(HTTPStatus.BAD_REQUEST, "side must be BLUE or RED")
            with SERVICE.lock:
                return self._json(agent_observation(SERVICE.state, side))  # type: ignore[arg-type]
        return self._static(parsed.path)

    def do_POST(self) -> None:  # noqa: N802
        try:
            body = self._read_json()
            if self.path == "/api/new-game":
                return self._json(SERVICE.reset(int(body.get("seed", 7))))
            if self.path == "/api/turn":
                return self._json(SERVICE.human_turn(body.get("side", "BLUE"), body.get("orders", [])))
            if self.path == "/api/agent-turn":
                return self._json(SERVICE.agent_turn())
            if self.path == "/api/autoplay":
                turns = max(1, min(20, int(body.get("turns", 1))))
                result = SERVICE.state.to_dict()
                for _ in range(turns):
                    if SERVICE.state.status != "ACTIVE":
                        break
                    result = SERVICE.agent_turn()
                return self._json(result)
            return self._error(HTTPStatus.NOT_FOUND, "Unknown API endpoint")
        except (OrderError, ValueError, KeyError, TypeError) as exc:
            return self._error(HTTPStatus.BAD_REQUEST, str(exc))

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 1_000_000:
            raise ValueError("request body too large")
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def _json(self, payload: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
        encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def _error(self, status: HTTPStatus, message: str) -> None:
        self._json({"error": message}, status)

    def _static(self, path: str) -> None:
        relative = "index.html" if path in ("", "/") else path.lstrip("/")
        candidate = (STATIC_ROOT / relative).resolve()
        if STATIC_ROOT.resolve() not in candidate.parents and candidate != STATIC_ROOT.resolve():
            return self._error(HTTPStatus.FORBIDDEN, "Invalid path")
        if not candidate.is_file():
            candidate = STATIC_ROOT / "index.html"
        data = candidate.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mimetypes.guess_type(candidate.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Open TOW local web application")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Open TOW running at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
