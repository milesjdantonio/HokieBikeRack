#pragma once
// State of the emulated hardware around the firmware model (firmware/model/README.md).
// hw.cpp fills it in; model_api.cpp reports it to the page. Nothing in here decides what the
// rack does: that is the unchanged firmware in src/ and lib/hbr_logic/.
#include <stdint.h>

#include <map>
#include <string>
#include <vector>

namespace model {

// Things the model has to assume because they are physics or other people's chips, not our
// code. Shown on the page under "Model Assumptions" so nobody mistakes them for firmware values.
struct Assumptions {
  uint32_t wifiConnectMs = 2500;  // ESP32 joining a phone hotspot (typically 1-4 s)
  uint32_t ntpDelayMs = 1200;     // first NTP answer after configTime()
  uint32_t pn532DetectMs = 20;    // PN532 noticing a card that entered the field
  float mpuNoiseG = 0.003f;       // MPU-6050 noise at the 44 Hz filter (datasheet ~400 ug/sqrt(Hz))
  float servoDegPerS = 600;       // MG90S at 4.8 V: 0.1 s per 60 degrees (datasheet)
  int servoUs0 = 500;             // MG90S pulse for 0 degrees (typical; varies per servo)
  int servoUs180 = 2400;          // MG90S pulse for 180 degrees
  const char *hotspotIp = "172.20.10.3";
  int rssi = -58;
};

struct Edge {  // a GPIO pin changed level
  uint32_t ms;
  uint8_t pin;
  uint8_t level;
};

struct Hw {
  Assumptions assume;

  // virtual clock (microseconds since this boot)
  uint64_t us = 0;
  double worldEpochAtBoot = 0;  // real-world time when this boot started

  // GPIO
  uint8_t level[40] = {};
  uint8_t mode[40] = {};
  std::vector<Edge> edges;

  // serial port
  unsigned long baud = 0;
  std::string serialOut;
  std::string serialIn;

  // I2C bus
  int sda = -1, scl = -1;
  uint32_t i2cHz = 0;
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

  // the MPU-6050
  uint8_t mpuReg[128] = {};
  uint8_t mpuPtr = 0;
  int16_t mpuRaw[3] = {};
  float mpuG[3] = {0, 0, 1};
  uint32_t mpuReads = 0;
  uint32_t mpuLastReadMs = 0, mpuReadGapMs = 0;

  // the servo signal (GPIO, pulse width)
  int servoPin = -1, servoMinUs = 0, servoMaxUs = 0, servoUs = 0, servoHz = 0;
  uint32_t servoWrites = 0;
  std::vector<std::pair<uint32_t, int>> servoLog;  // (ms, pulse us)

  // Wi-Fi, internet time
  bool hotspotOn = true;
  uint64_t hotspotOnUs = 0;
  bool wifiBegun = false;
  uint64_t wifiBeginUs = 0;
  uint32_t wifiBegins = 0;
  bool ntpConfigured = false;
  uint64_t ntpDueUs = 0;
  bool clockSet = false;
  uint32_t httpRequests = 0;

  // reset, flash
  int resetReason = 1;  // ESP_RST_POWERON
  bool restartRequested = false;
  bool fsMounted = false;
  std::map<std::string, std::string> files;
  std::vector<std::string> eventLines;  // lines appended to /events.jsonl (watched on the flash)

  // the network task (FreeRTOS)
  std::string taskName;
  uint32_t taskStack = 0;
  int taskCore = -1;
  uint64_t taskNextUs = 0;
  uint32_t taskRuns = 0;
};

Hw &hw();
bool wifiConnected();
void refreshClock();

}  // namespace model
