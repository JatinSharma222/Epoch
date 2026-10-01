.PHONY: check test build fmt clippy clean

check: fmt clippy test anchor-test

fmt:
	cargo fmt --all -- --check

clippy:
	cargo clippy --all-targets -- -D warnings

test:
	cargo test

anchor-test:
	anchor test

build:
	anchor build

clean:
	cargo clean
	rm -rf target/
