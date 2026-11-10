#pragma once
// Fake <avr/wdt.h> (the firmware model). The emulated watchdog in firmware/model/hw.cpp
// restarts the model's Uno if wdt_reset() isn't called within the timeout, like the real
// chip: a new WebAssembly instance, RAM gone, EEPROM kept.
#include <stdint.h>

// Timeout codes, as in avr-libc.
#define WDTO_15MS 0
#define WDTO_30MS 1
#define WDTO_60MS 2
#define WDTO_120MS 3
#define WDTO_250MS 4
#define WDTO_500MS 5
#define WDTO_1S 6
#define WDTO_2S 7
#define WDTO_4S 8
#define WDTO_8S 9

void wdt_enable(uint8_t timeout);
void wdt_disable();
void wdt_reset();

// The MCU status register (which kind of reset happened). main.cpp clears it at start-up.
extern volatile uint8_t hbr_model_mcusr;
#define MCUSR hbr_model_mcusr
