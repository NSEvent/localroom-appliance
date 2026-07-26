.PHONY: setup build test e2e ios-test gate run seed

setup:
	npm ci
	npm ci --prefix apps/console

build:
	npm run check

test:
	npm test

e2e:
	npm run test:e2e

ios-test:
	npm run test:ios

gate:
	npm run gate

run:
	npm start

seed:
	npm run demo:seed
