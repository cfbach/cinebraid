#!/usr/bin/env python3
"""EV2-4 supersedes the old mixed-audience Bible renderer contract.
Run the actual-app dossier + Approved-record workflow gate from the existing command.
"""
import pathlib, runpy
runpy.run_path(str(pathlib.Path(__file__).with_name('ev2-4-bible-real-browser.py')),run_name='__main__')
