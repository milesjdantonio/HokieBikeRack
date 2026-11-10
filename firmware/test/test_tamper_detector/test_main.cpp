// PC unit tests for tamper detection. Run: pio test -e native
// These "simulate" an accelerometer: still = (0, 0, 1 g), shaking = big swings.
#include <unity.h>

#include "tamper_detector.h"

using namespace hbr;

static uint32_t now = 0;
static const uint32_t kSampleMs = 20;  // 50 samples per second, like the firmware

// Feed `ms` worth of still readings. Returns the last signal seen (or None).
static TamperSignal feedStill(TamperDetector &d, uint32_t ms, bool armed = true) {
  TamperSignal last = TamperSignal::None;
  for (uint32_t t = 0; t < ms; t += kSampleMs) {
    TamperSignal s = d.update(0.01f, -0.02f, 1.0f, now, armed);
    if (s != TamperSignal::None) last = s;
    now += kSampleMs;
  }
  return last;
}

// Feed a shake: readings alternate +/- 0.8 g on x. Returns the strongest signal.
static TamperSignal feedShake(TamperDetector &d, uint32_t ms, bool armed = true) {
  TamperSignal strongest = TamperSignal::None;
  int i = 0;
  for (uint32_t t = 0; t < ms; t += kSampleMs, i++) {
    float x = (i % 2) ? 0.8f : -0.8f;
    TamperSignal s = d.update(x, 0.0f, 1.0f, now, armed);
    if (s == TamperSignal::Alarm || (s == TamperSignal::Warning && strongest == TamperSignal::None))
      strongest = s;
    now += kSampleMs;
  }
  return strongest;
}

void setUp() { now = 100000; }
void tearDown() {}

void test_still_rack_never_triggers() {
  TamperDetector d;
  TEST_ASSERT_EQUAL(static_cast<int>(TamperSignal::None),
                    static_cast<int>(feedStill(d, 60000)));
}

void test_single_spike_is_ignored() {
  TamperDetector d;
  feedStill(d, 3000);
  // One crazy sample (electrical noise), then still again.
  TEST_ASSERT_EQUAL(static_cast<int>(TamperSignal::None),
                    static_cast<int>(d.update(3.0f, 3.0f, 3.0f, now, true)));
  now += kSampleMs;
  TEST_ASSERT_EQUAL(static_cast<int>(TamperSignal::None), static_cast<int>(feedStill(d, 1000)));
}

void test_shaking_during_warmup_is_ignored() {
  TamperDetector d;
  TEST_ASSERT_EQUAL(static_cast<int>(TamperSignal::None), static_cast<int>(feedShake(d, 1500)));
}

void test_first_shake_is_warning_then_continued_shake_is_alarm() {
  TamperDetector d;
  feedStill(d, 3000);
  TEST_ASSERT_EQUAL(static_cast<int>(TamperSignal::Warning), static_cast<int>(feedShake(d, 500)));
  feedStill(d, 3000);  // past the 3 s cooldown, inside the 30 s escalation window
  TEST_ASSERT_EQUAL(static_cast<int>(TamperSignal::Alarm), static_cast<int>(feedShake(d, 500)));
  TEST_ASSERT_TRUE(d.alarmActive(now));
}

void test_alarm_stops_after_10_seconds() {
  TamperDetector d;
  feedStill(d, 3000);
  feedShake(d, 300);
  feedStill(d, 3000);
  feedShake(d, 300);
  TEST_ASSERT_TRUE(d.alarmActive(now));
  feedStill(d, 10000);
  TEST_ASSERT_FALSE(d.alarmActive(now));
}

// Warning, then alarm. Returns with the siren just started.
static void startAlarm(TamperDetector &d) {
  feedStill(d, 3000);
  feedShake(d, 300);
  feedStill(d, 3000);
  TEST_ASSERT_EQUAL(static_cast<int>(TamperSignal::Alarm), static_cast<int>(feedShake(d, 100)));
}

void test_alarm_runs_at_least_10_seconds_when_still() {
  TamperDetector d;
  startAlarm(d);
  feedStill(d, 9500);  // still since the alarm started, but under the 10 s minimum
  TEST_ASSERT_TRUE(d.alarmActive(now));
  feedStill(d, 600);
  TEST_ASSERT_FALSE(d.alarmActive(now));
}

void test_shaking_keeps_alarm_going_until_5_seconds_still() {
  TamperDetector d;
  startAlarm(d);
  for (int i = 0; i < 5; i++) {  // keeps getting shaken for ~20 s
    feedStill(d, 3500);
    feedShake(d, 500);
  }
  TEST_ASSERT_TRUE(d.alarmActive(now));
  feedStill(d, 4800);  // not yet 5 s since the last jolt
  TEST_ASSERT_TRUE(d.alarmActive(now));
  TEST_ASSERT_TRUE(d.alarmLeftMs(now) <= 200);
  feedStill(d, 300);
  TEST_ASSERT_FALSE(d.alarmActive(now));
}

void test_jolt_late_in_alarm_leaves_5_more_seconds() {
  TamperDetector d;
  startAlarm(d);
  feedStill(d, 9000);
  feedShake(d, 200);  // at ~9 s: the siren now ends 5 s after this, not at 10 s
  feedStill(d, 2000);
  TEST_ASSERT_TRUE(d.alarmActive(now));
  feedStill(d, 3200);
  TEST_ASSERT_FALSE(d.alarmActive(now));
}

void test_jolt_within_30_seconds_of_siren_stopping_is_alarm_again() {
  TamperDetector d;
  startAlarm(d);
  feedShake(d, 15000);  // shaken the whole time: siren keeps going
  feedStill(d, 5100);   // still: siren stops
  TEST_ASSERT_FALSE(d.alarmActive(now));
  feedStill(d, 25000);  // 25 s after it stopped (but 45 s after the alarm started)
  TEST_ASSERT_EQUAL(static_cast<int>(TamperSignal::Alarm), static_cast<int>(feedShake(d, 300)));
}

void test_one_long_shake_inside_cooldown_gives_one_warning() {
  TamperDetector d;
  feedStill(d, 3000);
  // Shake that includes brief calm gaps, all within 2 s (< 3 s cooldown).
  TEST_ASSERT_EQUAL(static_cast<int>(TamperSignal::Warning), static_cast<int>(feedShake(d, 400)));
  feedStill(d, 200);
  TEST_ASSERT_EQUAL(static_cast<int>(TamperSignal::None), static_cast<int>(feedShake(d, 400)));
}

void test_calm_for_long_time_resets_to_warning_level() {
  TamperDetector d;
  feedStill(d, 3000);
  feedShake(d, 300);
  feedStill(d, 31000);  // longer than the 30 s escalation window
  TEST_ASSERT_EQUAL(static_cast<int>(TamperSignal::Warning), static_cast<int>(feedShake(d, 300)));
}

void test_disarmed_while_rider_uses_rack() {
  TamperDetector d;
  feedStill(d, 3000);
  TEST_ASSERT_EQUAL(static_cast<int>(TamperSignal::None),
                    static_cast<int>(feedShake(d, 1000, /*armed=*/false)));
}

void test_silence_stops_alarm_and_escalation() {
  TamperDetector d;
  feedStill(d, 3000);
  feedShake(d, 300);
  feedStill(d, 3000);
  feedShake(d, 300);
  TEST_ASSERT_TRUE(d.alarmActive(now));
  d.silence();  // allowed card tapped
  TEST_ASSERT_FALSE(d.alarmActive(now));
  feedStill(d, 500);
  TEST_ASSERT_EQUAL(static_cast<int>(TamperSignal::Warning), static_cast<int>(feedShake(d, 300)));
}

void test_works_across_millis_wraparound() {
  now = 0xFFFFFFFFu - 4000;  // millis() is about to wrap to 0
  TamperDetector d;
  feedStill(d, 3000);
  TEST_ASSERT_EQUAL(static_cast<int>(TamperSignal::Warning), static_cast<int>(feedShake(d, 300)));
  feedStill(d, 3000);  // crosses the wrap
  TEST_ASSERT_EQUAL(static_cast<int>(TamperSignal::Alarm), static_cast<int>(feedShake(d, 300)));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_still_rack_never_triggers);
  RUN_TEST(test_single_spike_is_ignored);
  RUN_TEST(test_shaking_during_warmup_is_ignored);
  RUN_TEST(test_first_shake_is_warning_then_continued_shake_is_alarm);
  RUN_TEST(test_alarm_stops_after_10_seconds);
  RUN_TEST(test_alarm_runs_at_least_10_seconds_when_still);
  RUN_TEST(test_shaking_keeps_alarm_going_until_5_seconds_still);
  RUN_TEST(test_jolt_late_in_alarm_leaves_5_more_seconds);
  RUN_TEST(test_jolt_within_30_seconds_of_siren_stopping_is_alarm_again);
  RUN_TEST(test_one_long_shake_inside_cooldown_gives_one_warning);
  RUN_TEST(test_calm_for_long_time_resets_to_warning_level);
  RUN_TEST(test_disarmed_while_rider_uses_rack);
  RUN_TEST(test_silence_stops_alarm_and_escalation);
  RUN_TEST(test_works_across_millis_wraparound);
  return UNITY_END();
}
