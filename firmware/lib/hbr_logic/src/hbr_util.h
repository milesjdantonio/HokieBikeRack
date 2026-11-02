#pragma once
// Small helpers with no hardware: UUIDs, time text, hex, card debounce.
// Tested in firmware/test/test_util.
#include <stddef.h>
#include <stdint.h>

#include <string>

namespace hbr {

// Turns 16 random bytes into a version-4 UUID string like
// "1b4e28ba-2fa1-41d2-883f-0016d3cca427". The backend stores event IDs as
// UUIDs, and a stable ID per event is what makes retries safe (idempotent).
std::string formatUuidV4(const uint8_t randomBytes[16]);

// 1730559845 -> "2024-11-02T15:04:05Z" (UTC, ISO-8601). Returns "" for <= 0.
std::string formatIsoUtc(int64_t epochSeconds);

// Any time before 2025-01-01 means the clock was never set (the ESP32 starts
// at 1970 after power-on until NTP sets it).
constexpr int64_t kEarliestPlausibleEpoch = 1735689600;  // 2025-01-01T00:00:00Z
inline bool isClockPlausible(int64_t epochSeconds) {
  return epochSeconds >= kEarliestPlausibleEpoch;
}

// {0xAB, 0x01} -> "ab01"
std::string toHex(const uint8_t *data, size_t length);

// A card held on the reader is seen over and over. Only act on it once:
// ignore the same card until it has been gone for `quietMs`.
class CardDebouncer {
 public:
  explicit CardDebouncer(uint32_t quietMs = 2000) : quietMs_(quietMs) {}
  // Returns true if this read should be acted on.
  bool shouldProcess(const std::string &cardKey, uint32_t nowMs) {
    bool same = hasLast_ && cardKey == lastKey_ && (nowMs - lastSeenMs_) < quietMs_;
    hasLast_ = true;
    lastKey_ = cardKey;
    lastSeenMs_ = nowMs;  // holding the card keeps refreshing this
    return !same;
  }

 private:
  uint32_t quietMs_;
  bool hasLast_ = false;
  std::string lastKey_;
  uint32_t lastSeenMs_ = 0;
};

}  // namespace hbr
