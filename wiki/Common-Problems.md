# Common Problems
> Find answers to previously answered questions, if this guide doesn't help you, please file a new issue.


## Error getting keys with HOOBS/Config-Ui-X

HOOBS and Config-Ui-X both utilise port 8080. If you are not using port 8080, your network may have a device hosting something on that port. To fix this issue, change the discovery port. [First appeared](https://github.com/iRayanKhan/homebridge-tuya-platform/issues/4).

## Device only partially works.

Your device may have different data points/commands than the plugin is defaulted to handle. To fix this issue, you currently have to manually edit the device type file for your specific device. Version 2.0 (Not in Beta yet), will allow you to fix this issue via the config.json file. [First appeared](https://github.com/iRayanKhan/homebridge-tuya-platform/issues/11)

## Can't get device keys.

Tuya has updated their SDK to prevent the MITM method used to extract deviceID and keys. A guide is being compiled to fix this issue. Alternatively a website is being updated to add support for the old Tuya apps, to keep this method going. [First appeared](https://github.com/iRayanKhan/homebridge-tuya-platform/issues/13)

## How to install the beta?

Currently there is no beta release that you can use via NPM. You can visit the RC branch, and git clone it from there. If you do not know how to Git Clone, a guide is being compiled. A new beta will be published soon, and this page will be constantly updated to reflect a new beta update, with instructions. [First appeared](No-ref-yet.com/)

