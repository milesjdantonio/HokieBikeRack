#include "device_status.h"

#include <time.h>

#include "hbr_util.h"

DeviceStatus deviceStatus;

int64_t deviceNowEpoch() {
  time_t now = time(nullptr);
  // Before NTP sets it, the ESP32 clock counts up from 1970.
  return hbr::isClockPlausible(static_cast<int64_t>(now)) ? static_cast<int64_t>(now) : 0;
}
