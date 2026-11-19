#pragma once
// Lock timing logic. Owner: Person A
// Decides WHEN the lock should be open. src/lock.cpp turns that into servo
// movement (or serial prints while simulated). Tested in test_lock_controller.
//
// An allowed card opens the lock; it re-locks by itself after `unlockMs` unless
// lock() is called first (src/main.cpp: the same card tapping again).
#include <stdint.h>

namespace hbr {

class LockController {
 public:
  explicit LockController(uint32_t unlockMs) : unlockMs_(unlockMs) {}

  void unlock(uint32_t nowMs) {
    unlocked_ = true;
    everUnlocked_ = true;
    unlockedAtMs_ = nowMs;
  }
  void lock(uint32_t nowMs) {
    if (unlocked_) lockedAtMs_ = nowMs;  // remember when it really closed (for the grace window)
    unlocked_ = false;
  }

  // Call every loop. Returns true exactly once, when the timer runs out.
  bool update(uint32_t nowMs) {
    // "now - start >= duration" still works when millis() wraps back to 0
    // (after ~49 days), because unsigned subtraction wraps too.
    if (unlocked_ && nowMs - unlockedAtMs_ >= unlockMs_) {
      unlocked_ = false;
      lockedAtMs_ = nowMs;
      return true;
    }
    return false;
  }

  bool isUnlocked() const { return unlocked_; }

  // True while unlocked or within `graceMs` after it locked again. Used to
  // ignore tamper jolts while a rider is pulling their bike out. Counted from
  // when it actually closed: a rider who locks after 5 s mustn't leave the
  // tamper sensor off for the rest of the 120 s unlock time.
  bool recentlyUnlocked(uint32_t nowMs, uint32_t graceMs) const {
    if (unlocked_) return true;
    if (!everUnlocked_) return false;
    return nowMs - lockedAtMs_ < graceMs;
  }

  uint32_t unlockMs() const { return unlockMs_; }

 private:
  uint32_t unlockMs_;
  bool unlocked_ = false;
  bool everUnlocked_ = false;
  uint32_t unlockedAtMs_ = 0;
  uint32_t lockedAtMs_ = 0;
};

}  // namespace hbr
