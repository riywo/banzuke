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
        # Node is all it takes (npm resolves takumi's native binary).
        default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24
            git
          ];
        };
      });
    };
}
