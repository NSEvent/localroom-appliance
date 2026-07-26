PROJECT := LocalRoom.xcodeproj
SCHEME := LocalRoom
CONFIG ?= Release
TEAM_ID ?= 542GXYT5Z2
DESTINATION ?= generic/platform=iOS

.PHONY: generate build app-path

generate:
	xcodegen generate

build: generate
	xcodebuild -project "$(PROJECT)" -scheme "$(SCHEME)" \
		-configuration "$(CONFIG)" -destination "$(DESTINATION)" \
		DEVELOPMENT_TEAM="$(TEAM_ID)" -allowProvisioningUpdates build

app-path: generate
	@xcodebuild -project "$(PROJECT)" -scheme "$(SCHEME)" \
		-configuration "$(CONFIG)" -destination "$(DESTINATION)" \
		DEVELOPMENT_TEAM="$(TEAM_ID)" -showBuildSettings | \
		awk -F ' = ' '/TARGET_BUILD_DIR/{dir=$$2} /WRAPPER_NAME/{name=$$2} END{print dir "/" name}'
