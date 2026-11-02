#include "hbr_util.h"

#include <stdio.h>

namespace hbr {

std::string toHex(const uint8_t *data, size_t length) {
  static const char kDigits[] = "0123456789abcdef";
  std::string out;
  out.reserve(length * 2);
  for (size_t i = 0; i < length; i++) {
    out.push_back(kDigits[data[i] >> 4]);
    out.push_back(kDigits[data[i] & 0x0F]);
  }
  return out;
}

std::string formatUuidV4(const uint8_t randomBytes[16]) {
  uint8_t b[16];
  for (int i = 0; i < 16; i++) b[i] = randomBytes[i];
  b[6] = (b[6] & 0x0F) | 0x40;  // version 4 = "random"
  b[8] = (b[8] & 0x3F) | 0x80;  // variant bits (RFC 4122)
  std::string hex = toHex(b, 16);
  return hex.substr(0, 8) + "-" + hex.substr(8, 4) + "-" + hex.substr(12, 4) + "-" +
         hex.substr(16, 4) + "-" + hex.substr(20, 12);
}

// Converts days since 1970-01-01 to a calendar date. This is Howard Hinnant's
// well-known "civil_from_days" algorithm; it avoids depending on gmtime(),
// which behaves differently on the PC vs the ESP32.
static void civilFromDays(int64_t z, int &year, unsigned &month, unsigned &day) {
  z += 719468;
  const int64_t era = (z >= 0 ? z : z - 146096) / 146097;
  const unsigned doe = static_cast<unsigned>(z - era * 146097);
  const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  const int64_t y = static_cast<int64_t>(yoe) + era * 400;
  const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const unsigned mp = (5 * doy + 2) / 153;
  day = doy - (153 * mp + 2) / 5 + 1;
  month = mp < 10 ? mp + 3 : mp - 9;
  year = static_cast<int>(y + (month <= 2));
}

std::string formatIsoUtc(int64_t epochSeconds) {
  if (epochSeconds <= 0) return "";
  int64_t days = epochSeconds / 86400;
  int64_t secs = epochSeconds % 86400;
  int year;
  unsigned month, day;
  civilFromDays(days, year, month, day);
  char buf[24];
  snprintf(buf, sizeof(buf), "%04d-%02u-%02uT%02d:%02d:%02dZ", year, month, day,
           static_cast<int>(secs / 3600), static_cast<int>((secs / 60) % 60),
           static_cast<int>(secs % 60));
  return buf;
}

}  // namespace hbr
