{
  description = "banzuke — an agent skill that draws banzuke ranking sheets as PNGs";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        # Node runs everything; bun and deno are here because the template ships a lockfile for
        # each of them, and `npm run locks` regenerates all three (the smoke tests need them too).
        default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24
            bun
            deno
            git
          ];
        };
      });
    };
}
