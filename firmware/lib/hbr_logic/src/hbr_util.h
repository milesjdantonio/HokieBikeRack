#pragma once
// Small helpers with no hardware: hex text and card debounce.
// Tested in firmware/test/test_feedback_lock_util.
//
// No std::string here: the Arduino Uno has no C++ standard library. Callers
// pass in their own char buffers instead.
#include <stddef.h>
#include <stdint.h>

namespace hbr {

// {0xAB, 0x01} -> "ab01". `out` must have room for 2 * length + 1 chars.
void toHex(const uint8_t *data, size_t length, char *out);

// "ab01" -> {0xAB, 0x01}. Reads exactly `length` bytes (2 * length hex
// characters, upper or lower case). Returns false on a bad character or if
// the text is too short.
bool fromHex(const char *text, uint8_t *out, size_t length);

// Longest card ID we keep. Most NFC cards have a 4- or 7-byte ID.
constexpr uint8_t kMaxCardIdLength = 10;

// A card held on the reader is seen over and over. Only act on it once:
// ignore the same card until it has been gone for `quietMs`.
class CardDebouncer {
 public:
  explicit CardDebouncer(uint32_t quietMs = 2000) : quietMs_(quietMs) {}
  // Returns true if this read should be acted on. IDs longer than
  // kMaxCardIdLength are compared on their first kMaxCardIdLength bytes.
  bool shouldProcess(const uint8_t *id, uint8_t length, uint32_t nowMs);

 private:
  uint32_t quietMs_;
  bool hasLast_ = false;
  uint8_t last_[kMaxCardIdLength] = {};
  uint8_t lastLength_ = 0;
  uint32_t lastSeenMs_ = 0;
};

}  // namespace hbr
