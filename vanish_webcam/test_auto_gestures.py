import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import Mock, patch

import numpy as np

from local_app import vanish_cam as app
from local_app.auto_gestures import AutoGate, AutoReading, classify_auto
from local_app.goku_effect import GokuGestureGate
from local_app.test_goku_effect import gesture_hand
from local_app.test_itachi_effect import hand as chest_hand, scene
from local_app.test_naruto_effect import JoinedHandsTests
from local_app.test_vanish_cam import hand_points, landmarks
from local_app.test_video_output import FakePanel, arguments

W, H = 320, 240
IMAGE = SimpleNamespace(width=W, height=H)


def victory(result):
    return app.victory_score(result, IMAGE)


def classify(hands, faces, world=(), mask=None):
    if mask is None:
        mask = scene()[2]
    return classify_auto(hands, list(world), faces, mask, W, H, victory)


class ClassifyAutoTests(unittest.TestCase):
    def test_fingers_on_forehead_is_goku_and_never_a_v(self):
        reading = classify([gesture_hand()], [(100, 40, 100, 120)])
        self.assertTrue(reading.goku)
        self.assertEqual(reading.victory, 0.0)

    def test_hands_together_at_chest_are_itachi(self):
        # Chin at y=90 px, hands meet around y=118 px: below the face.
        reading = classify([chest_hand(.47), chest_hand(.53)], [(130, 20, 60, 70)])
        self.assertTrue(reading.itachi)
        self.assertFalse(reading.naruto)
        self.assertTrue(reading.touching)

    def test_joined_palms_at_face_height_are_naruto(self):
        hands = [JoinedHandsTests.hand(0.45), JoinedHandsTests.hand(0.55)]
        reading = classify(hands, [(110, 40, 100, 120)])  # chin at y=160 px
        self.assertTrue(reading.naruto)
        self.assertFalse(reading.itachi)

    def test_v_sign_away_from_the_face(self):
        reading = classify([chest_hand(.8, .85)], [(130, 20, 60, 70)],
                           world=[landmarks(hand_points())])
        self.assertGreaterEqual(reading.victory, 0.62)
        self.assertFalse(reading.goku or reading.naruto or reading.itachi)

    def test_v_shape_near_the_forehead_is_ignored(self):
        reading = classify([chest_hand(.47, .3)], [(100, 40, 100, 120)],
                           world=[landmarks(hand_points())])
        self.assertEqual(reading.victory, 0.0)

    def test_nothing_visible(self):
        self.assertFalse(classify([], []).any)


class AutoGateTests(unittest.TestCase):
    def setUp(self):
        self.goku = GokuGestureGate(hold_seconds=1.0)
        self.gate = AutoGate(v_effect="particles")

    def test_v_needs_two_readings_and_maps_to_chosen_effect(self):
        v = AutoReading(victory=0.9)
        self.assertIsNone(self.gate.update(v, 0.0, self.goku))
        self.assertEqual(self.gate.update(v, 0.1, self.goku), "particles")

    def test_itachi_wins_over_naruto_and_v(self):
        both = AutoReading(itachi=True, victory=0.9)
        self.gate.update(both, 0.0, self.goku)
        self.assertEqual(self.gate.update(both, 0.1, self.goku), "itachi")

    def test_goku_needs_the_hold_and_blocks_other_gestures_meanwhile(self):
        times = [i * 0.1 for i in range(12)]
        results = [self.gate.update(AutoReading(goku=True, naruto=True), t, self.goku)
                   for t in times]
        self.assertEqual(results.count("goku"), 1)
        self.assertNotIn("naruto", results)
        self.assertEqual(results[times.index(1.0)], "goku")

    def test_after_an_effect_every_gesture_must_be_released(self):
        v = AutoReading(victory=0.9)
        self.gate.disarm()
        self.assertIsNone(self.gate.update(v, 0.0, self.goku))
        self.assertIsNone(self.gate.update(v, 0.1, self.goku))
        clear = AutoReading()
        self.assertIsNone(self.gate.update(clear, 0.2, self.goku))
        self.assertIsNone(self.gate.update(clear, 0.4, self.goku))  # 0.2 s clear: not yet
        self.assertIsNone(self.gate.update(clear, 0.6, self.goku))  # re-armed now
        self.gate.update(v, 0.7, self.goku)
        self.assertEqual(self.gate.update(v, 0.8, self.goku), "particles")


class AutoModeListTests(unittest.TestCase):
    def test_auto_is_offered_only_with_every_gesture(self):
        self.assertEqual(app.with_auto(app.ALL_MODES)[0], "auto")
        self.assertNotIn("auto", app.with_auto(("goku",)))
        self.assertNotIn("auto", app.with_auto(("normal", "particles")))


class AutoLoopTests(unittest.TestCase):
    def test_v_then_goku_and_back_in_the_real_loop(self):
        step = 0.05
        plan = []                       # (reading, key) per frame
        plan += [(AutoReading(victory=0.9), 0)] * 8          # V held 0.4 s -> Normal dissolve
        plan += [(AutoReading(), 0)] * 80                    # dissolve finishes
        plan += [(AutoReading(), ord("r"))]                  # Reaparecer button/key
        plan += [(AutoReading(), 0)] * 10                    # release time
        plan += [(AutoReading(goku=True), 0)] * 24           # 1 s Goku hold
        plan += [(AutoReading(), 0)] * 40                    # teleport out, release
        plan += [(AutoReading(goku=True), 0)] * 24           # hold again to return
        plan += [(AutoReading(), 0)] * 40
        plan += [(AutoReading(), ord("q"))]
        clock = [0.0]
        cursor = [0]
        background = np.full((80, 120, 3), 40, np.uint8)
        person = np.full((80, 120, 3), 160, np.uint8)

        def read_frame():
            clock[0] = cursor[0] * step
            cursor[0] += 1
            return True, person.copy()

        capture = Mock()
        capture.read.side_effect = read_frame
        recognizer = Mock()
        recognizer.read.side_effect = lambda image, ts, mask: plan[cursor[0] - 1][0]
        mask = np.zeros((80, 120), np.float32)
        mask[10:70, 30:90] = 1.0
        sound = Mock()
        keys = iter(key for _, key in plan)
        with ExitStack() as mocks:
            mocks.enter_context(patch.object(app, "download_models"))
            mocks.enter_context(patch.object(app, "create_tasks", return_value=(Mock(), recognizer)))
            mocks.enter_context(patch.object(app, "open_virtual_camera", return_value=None))
            mocks.enter_context(patch.object(app, "person_mask", return_value=mask))
            mocks.enter_context(patch.object(app, "VanishSound", return_value=sound))
            mocks.enter_context(patch.object(app.time, "perf_counter", side_effect=lambda: clock[0]))
            for name in ("namedWindow", "resizeWindow", "imshow", "pollKey"):
                mocks.enter_context(patch.object(app.cv2, name))
            mocks.enter_context(patch.object(app.cv2, "waitKey", side_effect=lambda delay: next(keys)))
            printed = mocks.enter_context(patch("builtins.print"))
            shared = {"panel": FakePanel(app.with_auto(app.ALL_MODES)),
                      "capture": capture, "background": background}
            args = arguments(mode="auto")
            args.auto_v, args.goku_delay = "normal", 1.0
            with ExitStack() as resources, ExitStack() as mode_resources:
                self.assertIsNone(app.run_camera(args, resources, mode_resources, "auto", shared))
        events = [c.args[0] for c in printed.call_args_list
                  if c.args and str(c.args[0]).startswith(("[Auto] Effetto", "[Auto] Ritorno"))]
        self.assertEqual(events, ["[Auto] Effetto: normal", "[Auto] Effetto: goku",
                                  "[Auto] Ritorno: goku"])
        self.assertEqual(sound.play.call_count, 2)  # Goku out and back; Normal is silent.
        self.assertEqual(shared["auto_effect"], "goku")


if __name__ == "__main__":
    unittest.main()
