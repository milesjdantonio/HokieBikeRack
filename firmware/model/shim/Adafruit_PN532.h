#pragma once
// Fake Adafruit_PN532 library (the firmware model). Talks to the emulated PN532 on the fake I2C
// bus. src/card_reader.cpp also reads the chip's "ready" byte directly with Wire, as on the rack.
#include <stdint.h>

#include "Wire.h"

#define PN532_I2C_ADDRESS (0x48 >> 1)  // 0x24
#define PN532_I2C_READY (0x01)
#define PN532_MIFARE_ISO14443A (0x00)

class Adafruit_PN532 {
 public:
  Adafruit_PN532(uint8_t irq, uint8_t reset, TwoWire *wire);
  bool begin();
  uint32_t getFirmwareVersion();
  bool SAMConfig();
  bool setPassiveActivationRetries(uint8_t maxRetries);
  bool startPassiveTargetIDDetection(uint8_t cardBaudRate);
  bool readDetectedPassiveTargetID(uint8_t *uid, uint8_t *uidLength);
};
