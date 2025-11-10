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
- [ ] use loops to draw a whole grid of cells on the map
- [ ] display token values directly on the cells
- [ ] add deterministic hashing (Luck) for token spawning
- [ ] allow clicking nearby cells to pick up a token
- [ ] add player inventory (only one token can be held)
- [ ] implement crafting by merging equal-value tokens
- [ ] detect win condition when a crafted token reaches value 8 or 16
- [ ] polish visuals and cell interactions
- [ ] test persistence and determinism across reloads
