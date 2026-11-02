#pragma once
// Small facts shared between the main loop (core 1) and the network task
// (core 0), e.g. for the heartbeat. Owner: shared
//
// std::atomic makes each read/write happen "all at once", so the other task
// never sees a half-written value. Fine for single numbers/flags; anything
// bigger (lists, strings) needs a mutex instead (see event_queue.cpp).
#include <stdint.h>

#include <atomic>

struct DeviceStatus {
  std::atomic<bool> readerOk{false};
  std::atomic<bool> accelOk{false};
  std::atomic<bool> lockUnlocked{false};
  std::atomic<bool> alarmActive{false};
  std::atomic<float> lastDeviationG{0.0f};
  std::atomic<bool> wifiConnected{false};
  std::atomic<bool> lastSyncOk{false};
};

extern DeviceStatus deviceStatus;

// Current UTC time in seconds since 1970, or 0 if the clock was never set
// (no successful NTP sync since power-on).
int64_t deviceNowEpoch();
