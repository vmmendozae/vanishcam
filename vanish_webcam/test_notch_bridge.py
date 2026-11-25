import io
import json
import unittest
from contextlib import ExitStack
from unittest.mock import Mock, patch

import numpy as np

from local_app import vanish_cam as app
from local_app.auto_gestures import AutoReading
from local_app.notch_bridge import NotchBridge
from local_app.test_video_output import arguments


class HeadlessEngineTests(unittest.TestCase):
    def test_notch_drives_background_capture_and_effects(self):
        """bg_capture -> review -> accept -> V effect -> appear -> mode switch -> quit."""
        out = io.StringIO()
        never = Mock()
        never.__iter__ = Mock(return_value=iter(()))
        with patch.object(NotchBridge, "_read", lambda self, inp: None):
            bridge = NotchBridge(out=out, inp=never)
        clock = [0.0]
        frame_no = [0]
        script = {3: ["bg_capture"], 160: ["bg_accept"], 175: ["vanish"],
                  300: ["appear"], 320: [("mode", "goku")], 340: ["quit"]}
        room = np.full((72, 128, 3), 40, np.uint8)
        person = room.copy()
        person[20:60, 50:80] = 200

        def read_frame():
            frame_no[0] += 1
            clock[0] = frame_no[0] * 0.04
            for cmd in script.get(frame_no[0], []):
                if isinstance(cmd, tuple):
                    bridge.commands.put({"cmd": cmd[0], "value": cmd[1]})
                else:
                    bridge.commands.put({"cmd": cmd})
            visible = not (20 <= frame_no[0] <= 150)
            return True, (person if visible else room).copy()

        capture = Mock()
        capture.read.side_effect = read_frame
        recognizer = Mock()
        recognizer.read.return_value = AutoReading()
        mask = np.zeros((72, 128), np.float32)
        mask[20:60, 50:80] = 1
        args = arguments(mode="auto")
        args.goku_delay, args.auto_v = 1.0, "normal"
        with ExitStack() as mocks:
            mocks.enter_context(patch.object(app, "NotchBridge", return_value=bridge))
            mocks.enter_context(patch.object(app, "download_models"))
            mocks.enter_context(patch.object(app, "open_camera", return_value=capture))
            mocks.enter_context(patch.object(app, "open_virtual_camera", return_value=None))
            mocks.enter_context(patch.object(app, "create_tasks", return_value=(Mock(), recognizer)))
            mocks.enter_context(patch.object(app, "person_mask", return_value=mask))
            mocks.enter_context(patch.object(app, "VanishSound"))
            mocks.enter_context(patch.object(app, "play_cue"))
            mocks.enter_context(patch.object(app.time, "perf_counter", side_effect=lambda: clock[0]))
            mocks.enter_context(patch.object(app.time, "monotonic", side_effect=lambda: clock[0]))
            for name in ("namedWindow", "resizeWindow", "imshow", "pollKey", "waitKey"):
                mocks.enter_context(patch.object(app.cv2, name, side_effect=AssertionError(name)))
            self.assertEqual(app.run_headless(args), 0)

        messages = [json.loads(line) for line in out.getvalue().splitlines()]
        phases = []
        for m in messages:
            if m["type"] == "status" and (not phases or phases[-1] != m["phase"]):
                phases.append(m["phase"])
        for expected in ("loading", "bg_framing", "bg_leave", "bg_capturing", "bg_review",
                         "ready", "effect", "vanished"):
            self.assertIn(expected, phases)
        self.assertLess(phases.index("bg_review"), phases.index("ready"))
        self.assertLess(phases.index("effect"), phases.index("vanished"))
        review = [m for m in messages if m.get("phase") == "bg_review"][-1]
        self.assertEqual(review["color"], "green")
        self.assertTrue(any(m["type"] == "preview" and m["kind"] == "background" for m in messages))
        modes = {m.get("mode") for m in messages if m["type"] == "status"}
        self.assertIn("goku", modes)
        self.assertEqual(messages[-1], {"type": "stopped"})


if __name__ == "__main__":
    unittest.main()
