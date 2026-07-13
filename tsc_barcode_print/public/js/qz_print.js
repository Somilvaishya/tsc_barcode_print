// Public JS for TSC Barcode Print via QZ Tray

var TSCPrinter = {
    qzLoaded: false,

    loadQz: function(callback) {
        if (window.qz) {
            this.qzLoaded = true;
            if(callback) callback();
            return;
        }

        // Dynamically load qz-tray.js from CDN for MVP
        var script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.min.js";
        script.onload = () => {
            this.qzLoaded = true;
            if(callback) callback();
        };
        document.head.appendChild(script);
    },

    connect: function(host, port) {
        return new Promise((resolve, reject) => {
            if (qz.websocket.isActive()) {
                resolve();
            } else {
                qz.websocket.connect({ host: host, port: port }).then(resolve).catch(reject);
            }
        });
    },

    printTSPL: function(template_name, item_code, batch_id, mfg_date, label_qty, no_of_copies) {
        return new Promise((resolve, reject) => {
            this.loadQz(() => {
                // Fetch settings first
                frappe.call({
                    method: "tsc_barcode_print.api.get_printer_settings",
                    callback: (r) => {
                        if (!r.message) return reject("Could not fetch printer settings");
                        let settings = r.message;
                        
                        this.connect(settings.qz_host, settings.qz_port).then(() => {
                            // Fetch rendered TSPL
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
                                    if(tspl_res.message && tspl_res.message.tspl) {
                                        let config = qz.configs.create(settings.printer_name);
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
                    }
                });
            });
        });
    }
};

window.TSCPrinter = TSCPrinter;
