#include "card_store.h"

#include <Arduino.h>
#include <EEPROM.h>

namespace {
// The real 1 KB EEPROM. update() only writes a byte if it changed: EEPROM
// wears out after ~100,000 writes per byte, so skipping same-value writes helps.
class EepromStore : public hbr::ByteStore {
 public:
  uint16_t size() const override { return EEPROM.length(); }
  uint8_t read(uint16_t address) const override { return EEPROM.read(address); }
  void write(uint16_t address, uint8_t value) override { EEPROM.update(address, value); }
};

EepromStore eeprom;
hbr::CardList list(eeprom);
}  // namespace

void cardStoreSetup() {
  if (list.begin()) {
    Serial.println(F("[cards] EEPROM had no card list; started an empty one"));
  }
  Serial.print(F("[cards] "));
  Serial.print(list.count());
  Serial.print(F(" of "));
  Serial.print(list.capacity());
  Serial.println(F(" card slots used"));
}

hbr::CardList &cardStore() { return list; }
