// PC unit tests for lights/sound patterns, lock timing, and small helpers.
// Run: pio test -e native
#include <unity.h>

#include "feedback_player.h"
#include "hbr_util.h"
#include "lock_controller.h"

using namespace hbr;

void setUp() {}
void tearDown() {}

// ---- Feedback (LEDs + buzzer) ----

void test_granted_is_green_with_short_beep_then_green_hold() {
  FeedbackPlayer p;
  p.play(Pattern::Granted, 1000, 5000);
  Output start = p.update(1010);
  TEST_ASSERT_TRUE(start.green);
  TEST_ASSERT_TRUE(start.buzzer);
  TEST_ASSERT_FALSE(start.red);
  Output later = p.update(3000);
  TEST_ASSERT_TRUE(later.green);
  TEST_ASSERT_FALSE(later.buzzer);
  p.update(6001);  // 5 s later: finished
  TEST_ASSERT_EQUAL(static_cast<int>(Pattern::None), static_cast<int>(p.current()));
}

void test_denied_is_red_never_green() {
  FeedbackPlayer p;
  p.play(Pattern::Denied, 0);
  for (uint32_t t = 0; t < 1000; t += 10) TEST_ASSERT_FALSE(p.update(t).green);
  TEST_ASSERT_TRUE(p.update(10).red);
}

void test_alarm_loops_for_10_seconds_then_stops() {
  FeedbackPlayer p;
  p.play(Pattern::TamperAlarm, 0, 10000);
  int buzzerOnSamples = 0;
  for (uint32_t t = 0; t < 10000; t += 10) buzzerOnSamples += p.update(t).buzzer ? 1 : 0;
  TEST_ASSERT_TRUE(buzzerOnSamples > 300);  // siren really sounded for a good part of it
  p.update(10001);
  TEST_ASSERT_EQUAL(static_cast<int>(Pattern::None), static_cast<int>(p.current()));
}

void test_less_important_pattern_does_not_interrupt_alarm() {
  FeedbackPlayer p;
  p.play(Pattern::TamperAlarm, 0, 10000);
  p.play(Pattern::Granted, 100, 5000);
  TEST_ASSERT_EQUAL(static_cast<int>(Pattern::TamperAlarm), static_cast<int>(p.current()));
  p.stop();  // what an allowed card does in main.cpp
  p.play(Pattern::Granted, 200, 5000);
  TEST_ASSERT_EQUAL(static_cast<int>(Pattern::Granted), static_cast<int>(p.current()));
}

void test_finished_pattern_lets_lower_one_play() {
  FeedbackPlayer p;
  p.play(Pattern::TamperWarning, 0);
  p.play(Pattern::Granted, 5000, 5000);  // warning (~950 ms) is long over
  TEST_ASSERT_EQUAL(static_cast<int>(Pattern::Granted), static_cast<int>(p.current()));
}

void test_idle_blip_shows_ready_state() {
  FeedbackPlayer p;
  p.setReady(true);
  TEST_ASSERT_TRUE(p.update(5000).green);    // inside the blip
  TEST_ASSERT_FALSE(p.update(5100).green);   // between blips
  p.setReady(false);
  TEST_ASSERT_TRUE(p.update(10000).red);
}

// ---- Lock timing ----

void test_lock_relocks_after_unlock_time() {
  LockController lock(5000);
  lock.unlock(1000);
  TEST_ASSERT_TRUE(lock.isUnlocked());
  TEST_ASSERT_FALSE(lock.update(5999));
  TEST_ASSERT_TRUE(lock.update(6000));   // fires once...
  TEST_ASSERT_FALSE(lock.update(6001));  // ...not again
  TEST_ASSERT_FALSE(lock.isUnlocked());
}

void test_second_tap_restarts_timer() {
  LockController lock(5000);
  lock.unlock(0);
  lock.unlock(4000);
  TEST_ASSERT_FALSE(lock.update(8000));
  TEST_ASSERT_TRUE(lock.update(9000));
}

void test_lock_works_across_millis_wrap() {
  LockController lock(5000);
  lock.unlock(0xFFFFFFFFu - 1000);
  TEST_ASSERT_FALSE(lock.update(1000));  // only ~2 s have passed
  TEST_ASSERT_TRUE(lock.update(4000));
}

void test_recently_unlocked_grace_window() {
  LockController lock(5000);
  TEST_ASSERT_FALSE(lock.recentlyUnlocked(0, 10000));  // never unlocked
  lock.unlock(0);
  lock.update(5000);
  TEST_ASSERT_TRUE(lock.recentlyUnlocked(14000, 10000));
  TEST_ASSERT_FALSE(lock.recentlyUnlocked(15000, 10000));
}

// ---- Helpers ----

void test_uuid_v4_format() {
  uint8_t bytes[16];
  for (int i = 0; i < 16; i++) bytes[i] = 0xFF;
  std::string id = formatUuidV4(bytes);
  TEST_ASSERT_EQUAL(36, id.size());
  TEST_ASSERT_EQUAL_STRING("ffffffff-ffff-4fff-bfff-ffffffffffff", id.c_str());
}

void test_iso_time_format() {
  TEST_ASSERT_EQUAL_STRING("1970-01-01T00:00:01Z", formatIsoUtc(1).c_str());
  TEST_ASSERT_EQUAL_STRING("", formatIsoUtc(0).c_str());  // 0 = "clock not set"
  TEST_ASSERT_EQUAL_STRING("2024-02-29T12:34:56Z", formatIsoUtc(1709210096).c_str());  // leap day
  TEST_ASSERT_EQUAL_STRING("2026-11-02T15:00:00Z", formatIsoUtc(1793631600).c_str());
}

void test_clock_plausibility() {
  TEST_ASSERT_FALSE(isClockPlausible(5));       // just booted, 1970
  TEST_ASSERT_TRUE(isClockPlausible(1793631600));
}

void test_hex() {
  const uint8_t data[] = {0x00, 0xAB, 0x7F};
  TEST_ASSERT_EQUAL_STRING("00ab7f", toHex(data, 3).c_str());
}

void test_debouncer_ignores_held_card() {
  CardDebouncer d(2000);
  TEST_ASSERT_TRUE(d.shouldProcess("A", 0));
  TEST_ASSERT_FALSE(d.shouldProcess("A", 500));
  TEST_ASSERT_FALSE(d.shouldProcess("A", 2400));  // still held (refreshed at 500)
  TEST_ASSERT_TRUE(d.shouldProcess("B", 2500));   // different card
  TEST_ASSERT_TRUE(d.shouldProcess("B", 5000));   // removed, tapped again later
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_granted_is_green_with_short_beep_then_green_hold);
  RUN_TEST(test_denied_is_red_never_green);
  RUN_TEST(test_alarm_loops_for_10_seconds_then_stops);
  RUN_TEST(test_less_important_pattern_does_not_interrupt_alarm);
  RUN_TEST(test_finished_pattern_lets_lower_one_play);
  RUN_TEST(test_idle_blip_shows_ready_state);
  RUN_TEST(test_lock_relocks_after_unlock_time);
  RUN_TEST(test_second_tap_restarts_timer);
  RUN_TEST(test_lock_works_across_millis_wrap);
  RUN_TEST(test_recently_unlocked_grace_window);
  RUN_TEST(test_uuid_v4_format);
  RUN_TEST(test_iso_time_format);
  RUN_TEST(test_clock_plausibility);
  RUN_TEST(test_hex);
  RUN_TEST(test_debouncer_ignores_held_card);
  return UNITY_END();
}
