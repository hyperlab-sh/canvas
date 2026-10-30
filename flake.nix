{
  description = "canvas: a local diagram service for coding agents, with a canvas editor and MCP server";

  # The package is the release archive for the system; nix/release.json (written by the release workflow) holds its version and hash.
  outputs = { self, nixpkgs }:
    let
      release = builtins.fromJSON (builtins.readFile ./nix/release.json);
      targets = {
        x86_64-linux = "linux-x64";
        aarch64-linux = "linux-arm64";
        x86_64-darwin = "darwin-x64";
        aarch64-darwin = "darwin-arm64";
      };
      forAll = nixpkgs.lib.genAttrs (builtins.attrNames targets);
    in
    {
      packages = forAll (system:
        let pkgs = nixpkgs.legacyPackages.${system}; in rec {
          canvas = pkgs.stdenvNoCC.mkDerivation {
            pname = "canvas";
            inherit (release) version;
            src = pkgs.fetchurl {
              url = "https://github.com/hyperlab-sh/canvas/releases/download/v${release.version}/canvas-${release.version}-${targets.${system}}.tar.gz";
              hash = release.hashes.${system};
            };
            # The archive has no top-level directory (bin/, share/ at its root), so unpack it into the build directory as it is.
            unpackPhase = "tar -xzf $src";
            # Stripping would corrupt the binary (bun plus an appended payload).
            dontStrip = true;
            # The Linux binary asks for the FHS loader, which NixOS does not have.
            nativeBuildInputs = pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.autoPatchelfHook ];
            buildInputs = pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.stdenv.cc.cc.lib ];
            installPhase = ''
              runHook preInstall
              mkdir -p $out
              cp -r bin share $out/
              install -Dm444 LICENSE NOTICE -t $out/share/doc/canvas
              runHook postInstall
            '';
            meta = {
              description = "Local diagram service for coding agents, with a canvas editor and MCP server";
              homepage = "https://github.com/hyperlab-sh/canvas";
              license = pkgs.lib.licenses.mit;
              mainProgram = "canvas";
              platforms = builtins.attrNames targets;
            };
          };
          default = canvas;
        });

      apps = forAll (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.canvas}/bin/canvas";
        };
      });
    };

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
}
