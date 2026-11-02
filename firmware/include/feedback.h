#pragma once
// Red LED, green LED and active buzzer. Owner: Person A
// The patterns themselves (timings, priorities) live in
// lib/hbr_logic/src/feedback_player.h; this file just drives the pins.
#include <stdint.h>

#include "feedback_player.h"

void feedbackSetup();
// Start a pattern. holdMs = green-on time for Granted, siren time for TamperAlarm.
void feedbackPlay(hbr::Pattern pattern, uint32_t holdMs = 0);
void feedbackStop();
// Idle blip colour: green = ready to accept cards, red = not ready.
void feedbackSetReady(bool ready);
// Call every loop().
void feedbackUpdate();
