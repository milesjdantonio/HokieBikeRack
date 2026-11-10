#pragma once
// The list of allowed cards, saved in the Uno's EEPROM. Owner: Person A
//
// No hardware here: the list reads and writes through a ByteStore, which is
// the real EEPROM on the Uno (src/card_store.cpp) and a plain array in the PC
// tests (firmware/test/test_card_list).
//
// What is saved per card: the first 16 bytes (32 hex characters) of its
// credential reference, never the raw card ID (see include/credential_ref.h).
// 16 bytes is still far too many to guess, and it lets 63 cards fit in 1 KB.
//
// EEPROM layout:
//   byte 0-1  'H' 'B'   says "this EEPROM holds a HokieBikeRack list"
//   byte 2    format version (1)
//   byte 3    how many cards are saved
//   byte 4+   the cards, 16 bytes each
//
// Power can be cut at any moment, so writes are ordered to stay safe:
//   add:    write the card first, THEN bump the count. A cut in between
//           just loses the half-added card.
//   remove: copy the last card over the removed one, THEN drop the count.
//           A cut in between leaves a harmless duplicate of the last card;
//           the removed card is already gone.
#include <stddef.h>
#include <stdint.h>

namespace hbr {

constexpr uint8_t kCardRefLength = 16;

// Turns a card ID into the reference we store:
//   HMAC-SHA256(key, "hbr-card-v1:" + card ID as lowercase hex), first 16 bytes.
// The full 32 bytes (64 hex characters) is exactly what the backend and
// tools/device_simulator.py call the "credential reference"; we keep the
// first half. Returns false if the ID is empty or longer than 10 bytes.
bool makeCardRef(const char *key, size_t keyLength, const uint8_t *cardId, uint8_t idLength,
                 uint8_t out[kCardRefLength]);

class ByteStore {
 public:
  virtual ~ByteStore() = default;
  virtual uint16_t size() const = 0;
  virtual uint8_t read(uint16_t address) const = 0;
  virtual void write(uint16_t address, uint8_t value) = 0;
};

enum class AddResult { Added, AlreadyListed, Full };

class CardList {
 public:
  explicit CardList(ByteStore &store) : store_(store) {}

  // Call once at start-up. If the store doesn't hold a valid list (brand-new
  // board, or used by another sketch before), it is wiped to an empty list.
  // Returns true if that happened.
  bool begin();

  uint8_t count() const;
  uint8_t capacity() const;

  // Index of this card in the list, or -1 if it isn't listed.
  int find(const uint8_t ref[kCardRefLength]) const;
  bool contains(const uint8_t ref[kCardRefLength]) const { return find(ref) >= 0; }

  AddResult add(const uint8_t ref[kCardRefLength]);
  // Returns false if `index` is out of range. The order of the other cards
  // may change.
  bool removeAt(uint8_t index);
  // Copies card number `index` into `out`. Returns false if out of range.
  bool get(uint8_t index, uint8_t out[kCardRefLength]) const;
  void clear();

 private:
  static constexpr uint16_t kHeaderSize = 4;
  uint16_t slotAddress(uint8_t index) const { return kHeaderSize + index * kCardRefLength; }
  void setCount(uint8_t count);

  ByteStore &store_;
};

}  // namespace hbr
