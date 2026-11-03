#pragma once
// Fake hardware random number generator (the firmware model): a seeded generator, so event IDs
// are still unique per boot.
#include <stddef.h>
#include <stdint.h>

uint32_t esp_random();
void esp_fill_random(void *buffer, size_t length);
