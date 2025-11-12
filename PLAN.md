# D3: Token Crafter

## Game Design Vision

A grid-based crafting game that uses the Leaflet map framework. Players collect and combine tokens from nearby cells on the map to create higher-value tokens. Each cell displays its token value, and gameplay centers around picking up and merging equal-value tokens within a limited interaction range.

## Technologies

- TypeScript for most game code, little to no explicit HTML, and all CSS collected in common `style.css` file
- Deno and Vite for building
- GitHub Actions + GitHub Pages for deployment automation

## Assignments

### D3.a: Core mechanics (token collection and crafting)

Key technical challenge: Can you assemble a map-based user interface using the Leaflet mapping framework?

Key gameplay challenge: Can players collect and craft tokens from nearby locations to finally make one of sufficiently high value?

#### Steps

- [x] delete everything in `main.ts`
- [x] put a basic Leaflet map on the screen
- [x] draw the player's location on the map
- [x] draw a rectangle representing one cell on the map
- [x] use loops to draw a whole grid of cells on the map
- [x] display token values directly on the cells
- [x] add deterministic hashing (Luck) for token spawning
- [x] allow clicking nearby cells to pick up a token
- [x] add player inventory (only one token can be held)
- [x] implement crafting by merging equal-value tokens
- [x] detect win condition when a crafted token reaches value 8 or 16
- [ ] polish visuals and cell interactions
- [ ] test persistence and determinism across reloads

## D3.b: Globe-spanning Gameplay

Key technical challenge: Expand the grid system to represent the entire globe and support dynamic loading/unloading of cells.
Key gameplay challenge: Allow player movement and world exploration while maintaining performance and interactivity.

### D3.b Steps

- [ ] Add player movement simulation buttons (N/S/E/W)
- [ ] Implement `movePlayer(dx, dy)` logic to change player’s cell position
- [ ] Refactor world grid to be Earth-anchored at (0,0) latitude and longitude
- [ ] Use player position as the center for visible cell range and interactions
- [ ] Update grid spawning logic to dynamically create/destroy cells as the player moves
- [ ] Implement “memoryless” behavior (cells reset when out of view)
- [ ] Extend crafting threshold (e.g., value 32 or higher triggers win)

### Software Requirements

- The interface offers movement buttons (N/S/E/W) to move the player by one grid step.
- Cells remain visible across the map and respawn dynamically as the player moves.
- The grid coordinate system is Earth-wide, anchored at Null Island (0,0).
- The grid uses latitude/longitude math for deterministic token placement.

### Gameplay Requirements

- Player can move their character independently or scroll the map to explore new regions.
- Only nearby cells are interactive based on the player’s position.
- Cells “forget” their state once out of view, allowing farming behavior.
- Crafting logic allows merging higher-value tokens and declares victory at a new threshold.

### Tips

- Create a `GridCell` interface (e.g., `{ i: number; j: number; }`) to represent cell identifiers separate from visual elements.
- Implement helper functions to convert between geographic coordinates and grid cell identifiers.
- Use Leaflet’s `moveend` event to detect when the player (or map) stops moving: [Leaflet map.moveend docs](https://leafletjs.com/reference.html#map-moveend)
- Keep rendering efficient by reusing cell objects and redrawing only when necessary.
