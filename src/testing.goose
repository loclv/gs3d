// The little harness the test roots share: one line per check, a tally, and a
// pass or fail the root turns into an exit code.
//
//   testing::check(near(a, b), "a is b");
//   if !testing::finish() { exit(1); }
//
// Both roots (test_math.goose and test_engine.goose) print the same way, so a
// failing run reads the same whichever layer broke.

import std;

namespace testing;

var g_checks: i64;
var g_failed: i64;

fn check(ok: bool, what: const u8[:]) {
    g_checks += 1;
    if ok {
        print("  ok    ", what);
    } else {
        g_failed += 1;
        print("  FAIL  ", what);
    }
}

// Print the tally. False if any check failed.
fn finish() -> bool {
    print(g_checks - g_failed, " of ", g_checks, " checks passed");
    if g_failed == 0 { return true; }
    print(g_failed, " FAILED");
    return false;
}
