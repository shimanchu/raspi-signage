from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime
from pathlib import Path

import pychromecast
import requests
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
BASE_DIR = Path(__file__).resolve().parent
SETTINGS_FILE = BASE_DIR / "settings.json"
DEFAULT_CAST_NAME = os.getenv("CAST_NAME", "").strip()
LATITUDE = os.getenv("LATITUDE", "").strip()
LONGITUDE = os.getenv("LONGITUDE", "").strip()
POLL_SECONDS = int(os.getenv("POLL_SECONDS", "5"))
EMPTY_CAST = {"playing": False, "title": "", "artist": "", "album": "", "image": ""}
lock = threading.RLock()


def load_selected_cast() -> str:
    try:
        value = json.loads(SETTINGS_FILE.read_text(encoding="utf-8")).get("cast_name")
        return value.strip() if isinstance(value, str) and value.strip() else DEFAULT_CAST_NAME
    except (OSError, ValueError, TypeError):
        return DEFAULT_CAST_NAME


selected_cast_name = load_selected_cast()
state = {
    "cast": EMPTY_CAST.copy(),
    "selected_cast": selected_cast_name,
    "weather": {"temperature": None, "precipitation": None, "code": None},
    "updated_at": None,
}


def save_selected_cast(name: str) -> None:
    temporary = SETTINGS_FILE.with_suffix(".tmp")
    temporary.write_text(
        json.dumps({"cast_name": name}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(SETTINGS_FILE)


def fetch_weather() -> dict | None:
    if not LATITUDE or not LONGITUDE:
        return None

    response = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": LATITUDE,
            "longitude": LONGITUDE,
            "current": "temperature_2m,weather_code",
            "daily": "precipitation_probability_max",
            "timezone": "Asia/Tokyo",
            "forecast_days": 1,
        },
        timeout=10,
    )
    response.raise_for_status()
    data = response.json()
    return {
        "temperature": data["current"]["temperature_2m"],
        "precipitation": data["daily"]["precipitation_probability_max"][0],
        "code": data["current"]["weather_code"],
    }


def find_cast(name: str):
    chromecasts, browser = pychromecast.get_listed_chromecasts(friendly_names=[name])
    if not chromecasts:
        browser.stop_discovery()
        return None, None
    cast = chromecasts[0]
    cast.wait(timeout=10)
    return cast, browser


def discover_cast_names() -> list[str]:
    chromecasts, browser = pychromecast.get_chromecasts(timeout=5)
    try:
        return sorted({cast.name for cast in chromecasts if cast.name}, key=str.casefold)
    finally:
        for cast in chromecasts:
            try:
                cast.disconnect()
            except Exception:
                pass
        browser.stop_discovery()


def cast_payload(cast) -> dict:
    if cast is None:
        return EMPTY_CAST.copy()
    status = cast.media_controller.status
    images = status.images or []
    return {
        "playing": status.player_state == "PLAYING",
        "title": status.title or "",
        "artist": status.artist or "",
        "album": status.album_name or "",
        "image": images[0].url if images else "",
    }


def close_cast(cast, browser) -> None:
    if cast is not None:
        try:
            cast.disconnect()
        except Exception:
            pass
    if browser is not None:
        try:
            browser.stop_discovery()
        except Exception:
            pass


def updater() -> None:
    cast = None
    cast_browser = None
    connected_name = None
    next_weather = 0.0

    while True:
        now = time.time()
        weather = None
        try:
            if now >= next_weather:
                weather = fetch_weather()
                next_weather = now + 900
        except Exception as exc:
            app.logger.warning("Weather update failed: %s", exc)
            next_weather = now + 60

        with lock:
            target_name = selected_cast_name

        if connected_name != target_name:
            close_cast(cast, cast_browser)
            cast = None
            cast_browser = None
            connected_name = target_name

        try:
            if not target_name:
                cast_data = EMPTY_CAST.copy()
            else:
                if cast is None:
                    cast, cast_browser = find_cast(target_name)
                cast_data = cast_payload(cast)
        except Exception as exc:
            app.logger.warning("Cast update failed: %s", exc)
            close_cast(cast, cast_browser)
            cast = None
            cast_browser = None
            cast_data = EMPTY_CAST.copy()

        with lock:
            state["cast"] = cast_data
            state["selected_cast"] = selected_cast_name
            if weather is not None:
                state["weather"] = weather
            state["updated_at"] = datetime.now().isoformat(timespec="seconds")
        time.sleep(POLL_SECONDS)


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/status")
def api_status():
    with lock:
        return jsonify(state)


@app.get("/api/casts")
def api_casts():
    try:
        return jsonify({"devices": discover_cast_names()})
    except Exception as exc:
        app.logger.warning("Cast discovery failed: %s", exc)
        return jsonify({"error": "Google Homeを検索できませんでした"}), 503


@app.post("/api/cast")
def api_select_cast():
    global selected_cast_name
    body = request.get_json(silent=True) or {}
    name = body.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > 100:
        return jsonify({"error": "機器名が不正です"}), 400
    name = name.strip()
    try:
        save_selected_cast(name)
    except OSError as exc:
        app.logger.warning("Settings save failed: %s", exc)
        return jsonify({"error": "設定を保存できませんでした"}), 500
    with lock:
        selected_cast_name = name
        state["selected_cast"] = name
        state["cast"] = EMPTY_CAST.copy()
    return jsonify({"selected_cast": name})


if __name__ == "__main__":
    threading.Thread(target=updater, daemon=True, name="signage-updater").start()
    app.run(host="127.0.0.1", port=8080, threaded=True)
