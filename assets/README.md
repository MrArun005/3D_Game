# Game Assets Directory — Halstead Bay

This directory contains production artwork, 3D models, and source assets created for the game.

## Directory Structure

```
assets/
├── art/                    # Promotional, marketing & UI artwork
│   ├── game_cover.jpg      # 16:9 cinematic key art (car, police helicopter, Halstead Bay skyline)
│   ├── app_icon.jpg        # 1:1 luxury metallic & neon game application icon
│   ├── splash_screen.jpg   # 16:9 atmospheric loading screen (Little Tokyo night boulevard)
│   └── game_banner.jpg     # 16:9 high-speed highway chase action banner
│
├── models/                 # Exported standalone 3D binary GLB models
│   ├── helicopter.glb      # Player luxury/military helicopter with canopy glass & twin turbines
│   ├── police_helicopter.glb # Police tactical helicopter with spotlight & strobes
│   ├── player_car.glb      # Full hero sports car with interior, wheels & lofted body
│   └── weapons_arsenal.glb # Complete weapons arsenal (Pistol, SMG, Shotgun, Rifle, Sniper)
│
├── renders/                # Character & district rendering contact sheets
└── source/                 # Authoring source greybox and prop kits
    └── props/
        ├── helipad/        # Elevated helicopter landing pad (LOD0, LOD1, LOD2)
        ├── roadblock_jersey/ # Heavy concrete Jersey barrier (LOD0, LOD1, LOD2)
        └── tactical_crate/ # Tactical police/military supply drop crate (LOD0, LOD1, LOD2)
```

## 3D Ingame Assets Ingested

The newly created 3D props are fully integrated into the game engine pipeline:
- **`public/models/props/helipad.glb`** — 372 tris (LOD0), 224 tris (LOD1), 176 tris (LOD2)
- **`public/models/props/roadblock_jersey.glb`** — 244 tris (LOD0), 80 tris (LOD1), 80 tris (LOD2)
- **`public/models/props/tactical_crate.glb`** — 264 tris (LOD0), 72 tris (LOD1), 72 tris (LOD2)
- Registered and indexed in **`public/models/manifest.json`**.
