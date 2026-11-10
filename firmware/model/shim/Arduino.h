#pragma once
// Fake Arduino AVR core (the Uno's) for the firmware model (firmware/model/README.md).
//
// The real firmware in src/ is compiled UNCHANGED against these files instead of the Arduino
// AVR core, so it can run in a browser. Everything here imitates the chip or a library: a
// virtual clock (millis, delay), GPIO pins, the serial port, flash strings (F(), PROGMEM).
// None of the rack's behaviour lives here; that all stays in src/ and lib/hbr_logic/.
#include <math.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <string>

#include "WString.h"
#include "avr/pgmspace.h"  // the AVR core includes it from Arduino.h too

#define HIGH 1
#define LOW 0
#define INPUT 0x0
#define OUTPUT 0x1
#define INPUT_PULLUP 0x2

#define DEC 10
#define HEX 16

// The Uno's pin numbers: D0..D13, then A0..A5 = 14..19. I2C is fixed to A4 (SDA) and A5 (SCL).
constexpr uint8_t NUM_DIGITAL_PINS = 20;
#define A0 14
#define A1 15
#define A2 16
#define A3 17
#define A4 18
#define A5 19
#define SDA 18
#define SCL 19

// ---- virtual clock: time only moves when the model says so ----
uint32_t millis();
uint32_t micros();
void delay(uint32_t ms);
void delayMicroseconds(uint32_t us);
void yield();

// ---- GPIO ----
void pinMode(uint8_t pin, uint8_t mode);
void digitalWrite(uint8_t pin, uint8_t value);
int digitalRead(uint8_t pin);

// Same as the AVR core's map().
long map(long x, long inMin, long inMax, long outMin, long outMax);

// ---- F("text"): on the Uno the text stays in flash. Here it's an ordinary string. ----
class __FlashStringHelper;
#define F(s) (reinterpret_cast<const __FlashStringHelper *>(PSTR(s)))

// ---- Print: what Serial has in common with the AVR core's Print class ----
class Print {
 public:
  virtual ~Print() = default;
  virtual size_t write(uint8_t c) = 0;
  virtual size_t write(const uint8_t *buffer, size_t size) {
    size_t n = 0;
    while (size--) n += write(*buffer++);
    return n;
  }
  size_t write(const char *s) { return s ? write(reinterpret_cast<const uint8_t *>(s), strlen(s)) : 0; }

  size_t print(const __FlashStringHelper *s) { return write(reinterpret_cast<const char *>(s)); }
  size_t print(const char *s) { return write(s); }
  size_t print(const String &s) { return write(reinterpret_cast<const uint8_t *>(s.c_str()), s.length()); }
  size_t print(char c) { return write(static_cast<uint8_t>(c)); }
  size_t print(unsigned char v, int base = DEC) { return printNumber(v, base); }
  size_t print(int v, int base = DEC) { return printSigned(v, base); }
  size_t print(unsigned int v, int base = DEC) { return printNumber(v, base); }
  size_t print(long v, int base = DEC) { return printSigned(v, base); }
  size_t print(unsigned long v, int base = DEC) { return printNumber(v, base); }
  size_t print(double v, int digits = 2) {
    char buf[48];
    int n = snprintf(buf, sizeof(buf), "%.*f", digits, v);
    return n > 0 ? write(reinterpret_cast<const uint8_t *>(buf), static_cast<size_t>(n)) : 0;
  }

  size_t println() { return write('\n'); }
  template <typename T>
  size_t println(const T &v) { return print(v) + println(); }
  template <typename T>
  size_t println(const T &v, int baseOrDigits) { return print(v, baseOrDigits) + println(); }

  virtual void flush() {}

 private:
  // Like the AVR core: base 10 shows a minus sign, other bases print the two's complement.
  size_t printSigned(long v, int base) {
    if (base == 10 && v < 0) return write('-') + printNumber(0ul - static_cast<unsigned long>(v), 10);
    return printNumber(static_cast<unsigned long>(v), base);
  }
  size_t printNumber(unsigned long n, int base) {
    if (base < 2) base = 10;
    char buf[8 * sizeof(long) + 1];
    char *p = &buf[sizeof(buf) - 1];
    *p = '\0';
    do {
      unsigned d = static_cast<unsigned>(n % base);
      n /= base;
      *--p = static_cast<char>(d < 10 ? '0' + d : 'A' + d - 10);  // upper case, like the core
    } while (n);
    return write(p);
  }
};

// ---- the serial port (USB to the laptop) ----
class HardwareSerial : public Print {
 public:
  void begin(unsigned long baud);
  int available();
  int read();
  size_t write(uint8_t c) override;
  size_t write(const uint8_t *buffer, size_t size) override;
  using Print::write;
  operator bool() const { return true; }
};
extern HardwareSerial Serial;
