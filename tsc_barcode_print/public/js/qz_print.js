// Public JS for TSC Barcode Print via QZ Tray

var TSCPrinter = {
    qzLoaded: false,

    loadQz: function(callback) {
        if (window.qz) {
            this.qzLoaded = true;
            if(callback) callback();
            return;
        }

        // Dynamically load qz-tray.js from CDN
        var script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.min.js";
        script.onload = () => {
            this.qzLoaded = true;
            if(callback) callback();
        };
        document.head.appendChild(script);
    },

    connect: function(host, port) {
        console.log("TSCPrinter.connect called. host:", host, "port:", port);
        return new Promise((resolve, reject) => {
            if (qz.websocket.isActive()) {
                console.log("QZ WebSocket is already active.");
                resolve();
            } else {
                let options = { host: host || "localhost" };
                console.log("Calling qz.websocket.connect with options:", JSON.stringify(options));
                qz.websocket.connect(options).then(() => {
                    console.log("QZ WebSocket connection successful.");
                    resolve();
                }).catch((err) => {
                    console.error("QZ WebSocket connection failed:", err);
                    reject(err);
                });
            }
        });
    },

    printTSPL: function(template_name, item_code, batch_id, mfg_date, label_qty, no_of_copies, printer_profile_name = null) {
        return new Promise((resolve, reject) => {
            this.loadQz(() => {
                // 1. Determine which printer profile to use
                let profile_promise;
                if (printer_profile_name) {
                    profile_promise = frappe.db.get_doc("Printer Profile", printer_profile_name);
                } else {
                    profile_promise = frappe.call({
                        method: "tsc_barcode_print.api.get_default_printer_profile"
                    }).then(r => r.message);
                }

                profile_promise.then(profile => {
                    if (!profile) {
                        let err = "No active Printer Profile found. Please configure one in 'Printer Profile' list.";
                        frappe.msgprint(err);
                        return reject(err);
                    }

                    // 2. Fetch the template details to validate language
                    frappe.db.get_doc("Barcode Template", template_name).then(template => {
                        if (!template) {
                            let err = "Template not found: " + template_name;
                            frappe.msgprint(err);
                            return reject(err);
                        }

                        // Validate printer language matches template language
                        if (template.printer_language && profile.printer_language && template.printer_language !== profile.printer_language) {
                            let err = `Language Mismatch: Cannot send a ${template.printer_language} template to a ${profile.printer_language} printer.`;
                            frappe.msgprint(err);
                            return reject(err);
                        }

                        // 3. Connect to QZ Tray
                        this.connect("localhost").then(() => {
                            // 4. Fetch rendered code from server
                            frappe.call({
                                method: "tsc_barcode_print.api.render_barcode_template",
                                args: {
                                    template_name: template_name,
                                    item_code: item_code,
                                    batch_id: batch_id,
                                    mfg_date: mfg_date,
                                    label_qty: label_qty,
                                    no_of_copies: no_of_copies
                                },
                                callback: (tspl_res) => {
                                    if (tspl_res.message && tspl_res.message.tspl) {
                                        let config;
                                        if (profile.connection_type === "Network IP" && profile.ip_address) {
                                            config = qz.configs.create({ host: profile.ip_address, port: 9100 });
                                        } else {
                                            config = qz.configs.create(profile.printer_name);
                                        }

                                        let data = tspl_res.message.tspl; // Array of commands
                                        
                                        qz.print(config, data).then(() => {
                                            frappe.show_alert({message: "Printed successfully", indicator: "green"});
                                            resolve();
                                        }).catch((err) => {
                                            frappe.msgprint("Print Error: " + err);
                                            reject(err);
                                        });
                                    }
                                }
                            });
                        }).catch((err) => {
                            frappe.msgprint("Failed to connect to QZ Tray. Is it running?<br>" + err);
                            reject(err);
                        });
                    });
                }).catch(err => {
                    frappe.msgprint("Error fetching Printer Profile: " + err);
                    reject(err);
                });
            });
        });
    }
};

window.TSCPrinter = TSCPrinter;
