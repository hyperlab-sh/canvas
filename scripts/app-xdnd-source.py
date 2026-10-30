#!/usr/bin/env python3
"""A GTK drag source for CI: a window that offers one file URI, so xdotool can drag it onto the app (XDND).

usage: app-xdnd-source.py <file URI> <x> <y>
Prints "ready" once its window is mapped at (x, y) and "drag-end" when a drag from it finished, then exits;
the CI script requires both.
"""
import sys

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import Gdk, Gtk  # noqa: E402

uri, x, y = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])

window = Gtk.Window(title="canvas-xdnd-source")
window.set_default_size(300, 200)
window.move(x, y)
box = Gtk.EventBox()
box.add(Gtk.Label(label="drag me"))
box.drag_source_set(Gdk.ModifierType.BUTTON1_MASK, [Gtk.TargetEntry.new("text/uri-list", 0, 0)], Gdk.DragAction.COPY)
box.connect("drag-data-get", lambda _w, _ctx, data, _info, _time: data.set_uris([uri]))
box.connect("drag-end", lambda *_: (print("drag-end", flush=True), Gtk.main_quit()))
window.connect("map-event", lambda *_: print("ready", flush=True))
window.add(box)
window.show_all()
Gtk.main()
