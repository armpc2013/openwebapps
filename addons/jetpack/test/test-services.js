const FFRepoImpl = require("api").FFRepoImplService;
const {getOWA, installTestApp, getTestUrl} = require("./helpers/helpers");
const {Cc, Ci, Cm, Cu, components} = require("chrome");
const tabs = require("tabs");


function getContentWindow() {
  let wm = Cc["@mozilla.org/appshell/window-mediator;1"]
                .getService(Ci.nsIWindowMediator);

  let topWindow = wm.getMostRecentWindow("navigator:browser");
  let gBrowser = topWindow.gBrowser;
  let element = gBrowser.getBrowserForTab(gBrowser.selectedTab);
  return element.contentWindow.wrappedJSObject;
}


TestMediator = {
  url: getTestUrl("apps/testable_mediator.html"),
  contentScript:
    "window.navigator.apps.mediation.ready(function(activity, services) {" +
    "  let service = services[0];" +
    // XXX - why is unsafeWindow needed here???
    "  unsafeWindow.document.getElementById('servicebox').appendChild(service.iframe);" +
    "  service.on('ready', function() {" +
    "    dump('TestMediator calling now\\n');" +
    "    service.call(activity, 'echoArgs', function(result) {" +
    "      dump('TestMediator success callback - emitting result\\n');" +
    "      self.port.emit('result', result);" +
    "    }, function(errob) {" +
    "      dump('TestMediator failure callback - emitting result\\n');" +
    "      self.port.emit('result', errob);" +
    "    });" +
    "  });" +
    "});"
};

exports.test_invoke = function(test) {
  test.waitUntilDone();
  installTestApp(test, "apps/basic/basic.webapp", function() {
    // we don't yet have a "mediator" concept we can use, so we call some
    // internal methods to set things up bypassing the builtin mediator ui.
    let services = getOWA()._services;
    services.registerMediator("test.basic", TestMediator);
    let panel = services.get(
      getContentWindow(),
      {action:"test.basic", data: {hello: "world"}}, // simulate an Activity object
      function(result) { // success cb
        test.assertEqual(result.hello, "world");
        test.done();
      },
      function() { // error callback
        test.fail("error callback invoked");
      }
    );
    panel.show();
  });
};


// Test that having 2 tabs, each with its own panel, works as expected.
exports.test_invoke_twice = function(test) {
  test.waitUntilDone();
  let services = getOWA()._services;
  let seenTab1Callback = false;
  services.registerMediator("test.basic", TestMediator);
  installTestApp(test, "apps/basic/basic.webapp", function() {
    tabs.open({
      url: "about:blank",
      onOpen: function(tab1) {
        tab1.on('ready', function(){
          // first tab is open - create and invoke our test app.
          let panel1 = services.get(
            getContentWindow(),
            {action:"test.basic", data:{hello: "world"}}, // simulate an Activity object
            function(result) { // success cb
              if (seenTab1Callback) {
                test.fail("first tab got success callback twice");
                test.done();
                return;
              }
              seenTab1Callback = true;
              test.assertEqual(result.hello, "world");
              // yay - worked in the first tab - try the second.
              panel1.panel.hide();
              tabs.open({
                url: "about:blank",
                onOpen: function(tab2) {
                  tab2.on('ready', function(){
                    let panel2 = services.get(
                      getContentWindow(),
                      {action:"test.basic", data:{hello: "world"}}, // simulate an Activity object
                      function(result) { // success cb
                        test.assertEqual(result.hello, "world");
                        // yay - worked in the second tab too - all done!
                        tab2.close(function() {
                          tab1.close(function() {
                            test.done();
                          })
                        })
                      },
                      function() { // error callback
                        test.fail("error callback invoked");
                      }
                    );
                    panel2.show();
                  });
                }
              });
            },
            function() { // error callback
              test.fail("error callback invoked");
            }
          );
          panel1.show();
        });
      }
    });
  });
}

// Error tests.
TestMediatorError = {
  url: getTestUrl("apps/testable_mediator.html"),
  contentScript:
    "window.navigator.apps.mediation.ready(function(activity, services) {" +
    "  let service = services[0];" +
    // XXX - why is unsafeWindow needed here???
    "  unsafeWindow.document.getElementById('servicebox').appendChild(service.iframe);" +
    "  service.on('ready', function() {" +
    "    dump('TestMediatorError calling now\\n');" +
    "    service.call(activity, 'testErrors', function(result) {" +
    "      self.port.emit('result', {code: 'test_failure', msg: 'unexpected success callback'});" +
    "    }, function(errob) {" +
    "      self.port.emit('result', errob);" +
    "    });" +
    "  });" +
    "});"
};

// A helper for the error tests.
function testError(test, errchecker) {
  dump("\n\nBEGIN TEST postError\n");
  test.waitUntilDone();
  installTestApp(test, "apps/basic/basic.webapp", function() {
    let services = getOWA()._services;
    services.registerMediator("test.basic", TestMediatorError);
    let panel = services.get(
      getContentWindow(),
      {action:"test.basic", data:{}}, // simulate an activity
      function(result) { // success cb
        dump("\n\ntestError success callback invoked!\n");
        services._popups.pop();
        errchecker(result);
      },
      function(errob) { // error callback
        dump("\n\ntestError failure callback invoked!\n");
        test.fail("error callback invoked");
        services._popups.pop();
        test.done();
      }
    );
    panel.show();
  });
}

exports.test_invoke_error = function(test) {
  testError(test, function(errob) {
    test.assertEqual(errob.code, "testable_error");
    test.assertEqual(errob.message, "a testable error");
    test.done();
  });
};

