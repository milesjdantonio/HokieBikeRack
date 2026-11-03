#pragma once
// Fake internet time (NTP) for the firmware model: the clock is set a moment after Wi-Fi is up.
void configTime(long gmtOffsetSec, int daylightOffsetSec, const char *server1,
                const char *server2 = nullptr, const char *server3 = nullptr);
