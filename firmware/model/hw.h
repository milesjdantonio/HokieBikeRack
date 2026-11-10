#pragma once
// State of the emulated hardware around the firmware model (firmware/model/README.md).
// hw.cpp fills it in; model_api.cpp reports it to the page. Nothing in here decides what the
// rack does: that is the unchanged firmware in src/ and lib/hbr_logic/.
#include <setjmp.h>
#include <stdint.h>

#include <string>
#include <utility>
#include <vector>

namespace model {

// Things the model has to assume because they are physics or other people's chips, not our
// code. Shown on the page under "Model Assumptions" so nobody mistakes them for firmware values.
struct Assumptions {
  uint32_t pn532DetectMs = 20;    // PN532 noticing a card that entered the field
  float mpuNoiseG = 0.003f;       // MPU-6050 noise at the 44 Hz filter (datasheet ~400 ug/sqrt(Hz))
  float servoDegPerS = 600;       // MG90S at 4.8 V: 0.1 s per 60 degrees (datasheet)
  int servoUs0 = 500;             // MG90S pulse for 0 degrees (typical; varies per servo)
  int servoUs180 = 2400;          // MG90S pulse for 180 degrees
};

struct Edge {  // a GPIO pin changed level
  uint32_t ms;
  uint8_t pin;
  uint8_t level;
};

// Why the chip restarted (shown on the page; the firmware itself doesn't read it).
enum ResetReason { RESET_POWER_ON = 1, RESET_WATCHDOG = 2 };

constexpr uint16_t kEepromSize = 1024;  // ATmega328P
constexpr uint8_t kPins = 20;           // D0..D13, A0..A5

struct Hw {
  Assumptions assume;

  // virtual clock (microseconds since this boot)
  uint64_t us = 0;

  // GPIO
  uint8_t level[kPins] = {};
  uint8_t mode[kPins] = {};
  bool modeSet[kPins] = {};
  std::vector<Edge> edges;
  std::vector<int> badPins;  // pinMode()/digitalWrite() on a pin the Uno doesn't have

  // serial port
  unsigned long baud = 0;
  std::string serialOut;
  std::string serialIn;

  // I2C bus (always A4/A5 on the Uno)
  bool i2cBegun = false;
  uint32_t i2cHz = 100000;  // the AVR Wire library's default until setClock()
  uint32_t i2cTimeoutUs = 0;
  uint32_t i2cTx[128] = {};  // transactions per address since boot
  bool pn532Linked = true;   // false = SDA unplugged from the PN532
  bool mpuLinked = true;

  // the card on the PN532
  bool cardPresent = false;
  uint8_t uid[10] = {};
  uint8_t uidLength = 0;
  uint64_t cardSinceUs = 0;
  bool pnArmed = false;
  uint64_t pnArmedUs = 0;
  bool pnReady = false;  // a detected card ID is waiting to be read
  uint32_t pnReads = 0;  // card IDs handed to the firmware
  uint32_t pnPolls = 0;  // "ready?" bytes read
  uint32_t pnLastPollMs = 0, pnPollGapMs = 0;
  int pnIrqPin = -1, pnResetPin = -1;  // what the library was given

  // the MPU-6050
  uint8_t mpuReg[128] = {};
  uint8_t mpuPtr = 0;
  int16_t mpuRaw[3] = {};
  float mpuG[3] = {0, 0, 1};
  uint32_t mpuReads = 0;
  uint32_t mpuLastReadMs = 0, mpuReadGapMs = 0;

  // the servo signal (pin, pulse width)
  int servoPin = -1, servoMinUs = 0, servoMaxUs = 0, servoUs = 0;
  uint32_t servoWrites = 0;
  std::vector<std::pair<uint32_t, int>> servoLog;  // (ms, pulse us)

  // EEPROM: survives a power cycle (the page copies it into the next instance)
  uint8_t eeprom[kEepromSize];
  uint32_t eepromWrites = 0;  // bytes really written since this boot (update() skips equal ones)
  Hw() {
    for (uint8_t &b : eeprom) b = 0xFF;  // a blank chip reads 0xFF
  }

  // watchdog
  bool wdtOn = false;
  uint32_t wdtTimeoutMs = 0;
  uint64_t wdtKickUs = 0;
  uint32_t wdtKicks = 0;

  // reset
  int resetReason = RESET_POWER_ON;
  bool restartRequested = false;
};

Hw &hw();

// hbr_run_until() sets this up so a watchdog reset can leave loop() at once, wherever it is,
// the way the real chip drops everything when the watchdog fires.
extern jmp_buf resetJump;
extern bool resetJumpReady;

}  // namespace model
