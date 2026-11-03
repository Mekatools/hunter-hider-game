# 🗺️ Hunter vs Hider — Real-World Hide & Seek

A real-time, outdoor hide-and-seek game for mobile browsers built with Leaflet.js, OpenStreetMap, and Cloudflare Workers with authoritative SQLite Durable Objects.

## Features
- **Authoritative Server:** Catches, timers, and radar approximations run in Cloudflare Durable Objects.
- **Fair GPS Catch Engine:** Hunter must stay within 20m of a hider for 5 continuous seconds. Low-accuracy GPS readings (>50m) are ignored.
- **Pet Companion Radar:** 
  - Hunter Pets (Hawk, Wolf, Owl, Dragon) ping approximate hider regions with randomized radius jitter.
  - Hider Pets (Fox, Cat, Rabbit, Ghost) detect when hunters enter your danger zone.
- **Zero Build Step:** Native ES6 modules, CSS custom properties, and static assets hosted via Cloudflare Workers.

## Safety Rules
1. Never trespass on private property.
2. Stay alert and watch traffic at all times; do not run across roads.
3. Keep phone screen on with Wake Lock enabled.
