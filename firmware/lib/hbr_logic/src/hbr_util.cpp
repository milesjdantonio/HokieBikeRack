#include "hbr_util.h"

#include <string.h>

namespace hbr {

void toHex(const uint8_t *data, size_t length, char *out) {
  static const char kDigits[] = "0123456789abcdef";
  for (size_t i = 0; i < length; i++) {
    out[2 * i] = kDigits[data[i] >> 4];
    out[2 * i + 1] = kDigits[data[i] & 0x0F];
  }
  out[2 * length] = '\0';
}

namespace {
int hexValue(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}
}  // namespace

bool fromHex(const char *text, uint8_t *out, size_t length) {
  for (size_t i = 0; i < length; i++) {
    int hi = hexValue(text[2 * i]);
    if (hi < 0) return false;  // also catches the end of a too-short string
    int lo = hexValue(text[2 * i + 1]);
    if (lo < 0) return false;
    out[i] = static_cast<uint8_t>((hi << 4) | lo);
  }
  return true;
}

bool CardDebouncer::shouldProcess(const uint8_t *id, uint8_t length, uint32_t nowMs) {
  if (length > kMaxCardIdLength) length = kMaxCardIdLength;
  bool sameCard = hasLast_ && length == lastLength_ && memcmp(id, last_, length) == 0;
  bool same = sameCard && (nowMs - lastSeenMs_) < quietMs_;
  hasLast_ = true;
  memcpy(last_, id, length);
  lastLength_ = length;
  lastSeenMs_ = nowMs;  // holding the card keeps refreshing this
  return !same;
}

}  // namespace hbr
