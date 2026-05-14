const { RingApi } = require('ring-client-api');

async function test() {
    try {
        const ringApi = new RingApi({
            email: 'jason.jesus2013@gmail.com',
            password: 'Gecko@1984$',
            twoFactorCode: '032986',
            controlCenterDisplayName: "Scryvex Bridge"
        });
        await ringApi.getLocations();
        console.log("SUCCESS");
    } catch (e) {
        console.log("FULL_ERROR_MESSAGE:", e.message);
        console.log("FULL_ERROR_STACK:", e.stack);
    }
}
test();
