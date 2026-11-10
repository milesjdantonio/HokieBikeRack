#pragma once
// Fake Arduino EEPROM library (the firmware model): the Uno's 1 KB EEPROM, kept by the page
// across a Power Cycle like the real chip keeps it without power. hw.cpp counts real writes,
// because each byte of a real EEPROM survives only about 100,000 of them.
#include <stdint.h>

class EEPROMClass {
 public:
  uint16_t length();
  uint8_t read(int address);
  void write(int address, uint8_t value);
  void update(int address, uint8_t value);  // writes only if the byte changes
};
extern EEPROMClass EEPROM;
