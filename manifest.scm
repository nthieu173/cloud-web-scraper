;; Supplement the host environment with missing build dependencies.
;; Rust (rustup, pinned by rust-toolchain.toml), Guix, direnv, uv, Git, sccache
;; and ordinary shell utilities come from the host. Python-distributed tools
;; live in pyproject.toml/uv.lock; hook-specific tools remain owned by prek.toml.
(use-modules (guix profiles)
             ((gnu packages gcc) #:prefix gcc:))

(concatenate-manifests
 (list
  ;; Clang compiles ring's C code and links host build scripts; Node runs
  ;; worker.test.mjs (CI uses Node 24 too).
  (specifications->manifest '("make" "clang-toolchain" "node@24"))
  ;; Runtime libraries for host Rust build scripts.
  (packages->manifest `((,gcc:gcc "lib")))))
