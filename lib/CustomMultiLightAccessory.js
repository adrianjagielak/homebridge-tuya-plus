const CustomMultiOutletAccessory = require('./CustomMultiOutletAccessory');

// Multi-gang on/off light controllers (e.g. 2-gang wall switches) with the same
// `outlets` channel config as CustomMultiOutlet, but each channel exposed as a
// Lightbulb: Outlets show a plug icon and are left out of Siri's "turn on the
// lights" and the Home app's Lights group.
class CustomMultiLightAccessory extends CustomMultiOutletAccessory {
    static getCategory(Categories) {
        return Categories.LIGHTBULB;
    }

    _channelService() {
        return this.hap.Service.Lightbulb;
    }

    _channelSubtypePrefix() {
        return 'light';
    }
}

module.exports = CustomMultiLightAccessory;
