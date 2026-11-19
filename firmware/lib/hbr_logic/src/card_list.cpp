#include "card_list.h"

#include <string.h>

#include "hbr_util.h"
#include "hmac_sha256.h"

namespace hbr {

bool makeCardRef(const char *key, size_t keyLength, const uint8_t *cardId, uint8_t idLength,
                 uint8_t out[kCardRefLength]) {
  uint8_t mac[kCardMacLength];
  if (!makeCardMac(key, keyLength, cardId, idLength, mac)) return false;
  memcpy(out, mac, kCardRefLength);
  return true;
}

bool makeCardMac(const char *key, size_t keyLength, const uint8_t *cardId, uint8_t idLength,
                 uint8_t out[kCardMacLength]) {
  if (idLength == 0 || idLength > kMaxCardIdLength) return false;
  // "hbr-card-v1:" is a label so this hash can't be confused with any other
  // use of the same key, and so we can change the scheme later (v2).
  static const char kLabel[] = "hbr-card-v1:";
  constexpr size_t kLabelLength = sizeof(kLabel) - 1;
  char message[kLabelLength + 2 * kMaxCardIdLength + 1];
  memcpy(message, kLabel, kLabelLength);
  toHex(cardId, idLength, message + kLabelLength);
  hmacSha256(reinterpret_cast<const uint8_t *>(key), keyLength,
             reinterpret_cast<const uint8_t *>(message), kLabelLength + 2 * idLength, out);
  return true;
}

namespace {
constexpr uint8_t kMagic0 = 'H';
constexpr uint8_t kMagic1 = 'B';
constexpr uint8_t kFormatVersion = 1;
constexpr uint16_t kCountAddress = 3;
}  // namespace

bool CardList::begin() {
  bool valid = store_.size() > kHeaderSize + kCardRefLength && store_.read(0) == kMagic0 &&
               store_.read(1) == kMagic1 && store_.read(2) == kFormatVersion &&
               store_.read(kCountAddress) <= capacity();
  if (valid) return false;
  // Count first, header last: if power is cut half-way, the header is still
  // invalid and we simply start over next boot.
  store_.write(kCountAddress, 0);
  store_.write(2, kFormatVersion);
  store_.write(1, kMagic1);
  store_.write(0, kMagic0);
  return true;
}

uint8_t CardList::count() const { return store_.read(kCountAddress); }

uint8_t CardList::capacity() const {
  uint16_t slots = (store_.size() - kHeaderSize) / kCardRefLength;
  return slots > 255 ? 255 : static_cast<uint8_t>(slots);
}

void CardList::setCount(uint8_t count) { store_.write(kCountAddress, count); }

int CardList::find(const uint8_t ref[kCardRefLength]) const {
  uint8_t n = count();
  for (uint8_t i = 0; i < n; i++) {
    uint16_t at = slotAddress(i);
    uint8_t j = 0;
    while (j < kCardRefLength && store_.read(at + j) == ref[j]) j++;
    if (j == kCardRefLength) return i;
  }
  return -1;
}

AddResult CardList::add(const uint8_t ref[kCardRefLength]) {
  if (contains(ref)) return AddResult::AlreadyListed;
  uint8_t n = count();
  if (n >= capacity()) return AddResult::Full;
  uint16_t at = slotAddress(n);
  for (uint8_t j = 0; j < kCardRefLength; j++) store_.write(at + j, ref[j]);
  setCount(n + 1);  // only now does the new card "exist"
  return AddResult::Added;
}

bool CardList::removeAt(uint8_t index) {
  uint8_t n = count();
  if (index >= n) return false;
  uint8_t last = n - 1;
  if (index != last) {
    uint16_t from = slotAddress(last), to = slotAddress(index);
    for (uint8_t j = 0; j < kCardRefLength; j++) store_.write(to + j, store_.read(from + j));
  }
  setCount(last);
  return true;
}

bool CardList::get(uint8_t index, uint8_t out[kCardRefLength]) const {
  if (index >= count()) return false;
  uint16_t at = slotAddress(index);
  for (uint8_t j = 0; j < kCardRefLength; j++) out[j] = store_.read(at + j);
  return true;
}

void CardList::clear() { setCount(0); }

}  // namespace hbr
