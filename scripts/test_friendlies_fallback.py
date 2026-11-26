import unittest
from update_friendlies import build_snapshot

class FriendlyFallback(unittest.TestCase):
    def test_suspended_provider_fallback(self):
        def fake(url, headers=None):
            if "api-sports" in url:
                return {"errors":{"access":"suspended"}}
            if "/nonfifa/" in url:
                raise OSError("unavailable")
            return {"events":[{"id":"42","date":"2026-11-26T12:00:00Z","status":{"type":{"state":"in","shortDetail":"45'"}},"competitions":[{"competitors":[{"homeAway":"home","team":{"displayName":"A"},"score":"0"},{"homeAway":"away","team":{"displayName":"B"},"score":"0"}]}]}]}
        result=build_snapshot("2026-11-26","test",fake)
        self.assertEqual(result["source"],"ESPN")
        self.assertTrue(result["partial"])
        self.assertEqual(result["missingLeagues"],["nonfifa"])
        self.assertEqual(result["matches"][0]["score"],"0 - 0")
        self.assertEqual(result["matches"][0]["id"],"friendly:42")
    def test_all_fail(self):
        def fake(*args):
            raise OSError("offline")
        with self.assertRaises(ValueError):
            build_snapshot("2026-11-26","test",fake)
    def test_verified_empty_primary(self):
        result=build_snapshot("2026-11-26","test",lambda *a:{"response":[],"errors":[]})
        self.assertEqual(result["source"],"API-Football")
        self.assertFalse(result["partial"])
        self.assertEqual(result["matches"],[])
