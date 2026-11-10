#pragma once
// Fake <avr/pgmspace.h> (the firmware model). On the Uno, PROGMEM data and F()/PSTR() strings
// stay in flash and need special functions to read. In the browser there is only one kind of
// memory, so these are the ordinary C functions.
#include <stdint.h>
#include <string.h>

#define PROGMEM
#define PGM_P const char *
#define PSTR(s) (s)
#define pgm_read_byte(p) (*reinterpret_cast<const uint8_t *>(p))
#define pgm_read_word(p) (*reinterpret_cast<const uint16_t *>(p))
#define pgm_read_dword(p) (*reinterpret_cast<const uint32_t *>(p))
#define strcmp_P strcmp
#define strncmp_P strncmp
#define strlen_P strlen
#define memcpy_P memcpy
