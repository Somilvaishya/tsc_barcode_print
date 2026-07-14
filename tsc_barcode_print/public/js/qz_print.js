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

    loadJsBarcode: function(callback) {
        if (window.JsBarcode) {
            if(callback) callback();
            return;
        }
        var script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js";
        script.onload = () => {
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
                                            console.log("TSCPrinter: Print command successfully executed by QZ.");
                                            frappe.show_alert({message: "Printed successfully", indicator: "green"});
                                            
                                            // Auditing: log print action to backend
                                            let source_dt = (window.cur_frm && window.cur_frm.doctype) ? window.cur_frm.doctype : null;
                                            let source_dn = (window.cur_frm && window.cur_frm.docname) ? window.cur_frm.docname : null;
                                            
                                            console.log("TSCPrinter: Sending print log to backend. Source:", source_dt, source_dn);
                                            frappe.call({
                                                method: "tsc_barcode_print.api.log_barcode_print",
                                                args: {
                                                    template: template_name,
                                                    printer_profile: profile.name,
                                                    item_code: item_code,
                                                    batch_no: batch_id,
                                                    label_qty: label_qty,
                                                    no_of_copies: no_of_copies,
                                                    source_doctype: source_dt,
                                                    source_docname: source_dn
                                                },
                                                callback: function(r) {
                                                    console.log("TSCPrinter: Print log created successfully. Log Name:", r.message);
                                                },
                                                error: function(err) {
                                                    console.error("TSCPrinter: Failed to create print log. Error:", err);
                                                }
                                            });

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
    },

    renderPreview: function(container, template_doc, context) {
        this.loadJsBarcode(() => {
            container.innerHTML = "";
            
            // Scale mm to pixels (e.g. 1mm = 4.5px) for display
            let scale = 4.5;
            let width_mm = template_doc.label_width || 50;
            let height_mm = template_doc.label_height || 30;
            
            let width_px = width_mm * scale;
            let height_px = height_mm * scale;
            
            container.style.width = width_px + "px";
            container.style.height = height_px + "px";
            container.style.position = "relative";
            container.style.border = "1px solid #333";
            container.style.backgroundColor = "#fff";
            container.style.boxShadow = "0 6px 12px rgba(0,0,0,0.15)";
            container.style.margin = "0 auto";
            container.style.overflow = "hidden";

            // Substitute context in TSPL lines
            let substituted = template_doc.raw_tspl || "";
            for (let key in context) {
                let val = context[key] !== undefined && context[key] !== null ? context[key] : "";
                let regex = new RegExp("{{\\s*" + key + "\\s*}}", "g");
                substituted = substituted.replace(regex, val);
            }
            
            let lines = substituted.split("\n");
            lines.forEach(line => {
                line = line.trim();
                if (line.startsWith("TEXT")) {
                    // Format: TEXT x,y,"font",rotation,x_mul,y_mul,"content"
                    let match = line.match(/TEXT\s+(\d+)\s*,\s*(\d+)\s*,\s*"([^"]+)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"([^"]*)"/);
                    if (match) {
                        let x_mm = parseFloat(match[1]) / 8;
                        let y_mm = parseFloat(match[2]) / 8;
                        
                        let left_px = x_mm * scale;
                        let top_px = y_mm * scale;
                        let text = match[7];
                        
                        let el = document.createElement("div");
                        el.style.position = "absolute";
                        el.style.left = left_px + "px";
                        el.style.top = top_px + "px";
                        el.style.fontFamily = "monospace";
                        el.style.fontSize = "12px";
                        el.style.fontWeight = "bold";
                        el.style.color = "#000";
                        el.style.lineHeight = "1";
                        el.style.whiteSpace = "nowrap";
                        el.innerText = text;
                        
                        container.appendChild(el);
                    }
                } else if (line.startsWith("BARCODE")) {
                    // Format: BARCODE x,y,"code_type",height,human,rotation,narrow,wide,"content"
                    let match = line.match(/BARCODE\s+(\d+)\s*,\s*(\d+)\s*,\s*"([^"]+)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"([^"]*)"/);
                    if (match) {
                        let x_mm = parseFloat(match[1]) / 8;
                        let y_mm = parseFloat(match[2]) / 8;
                        let height_mm = parseFloat(match[4]) / 8;
                        
                        let left_px = x_mm * scale;
                        let top_px = y_mm * scale;
                        let barcode_height_px = height_mm * scale;
                        let barcode_type = match[3];
                        let text = match[9];
                        let show_human = parseInt(match[5]) === 1;
                        
                        let svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                        svg.style.position = "absolute";
                        svg.style.left = left_px + "px";
                        svg.style.top = top_px + "px";
                        container.appendChild(svg);
                        
                        try {
                            if (text && text.trim() !== "") {
                                JsBarcode(svg, text, {
                                    format: barcode_type === "128" ? "CODE128" : "CODE39",
                                    height: barcode_height_px,
                                    width: 1.2,
                                    displayValue: show_human,
                                    margin: 0,
                                    fontSize: 10,
                                    font: "monospace"
                                });
                            } else {
                                // Show placeholder
                                svg.innerHTML = `<rect width="100" height="${barcode_height_px}" fill="#eee" stroke="#ccc"></rect>
                                                 <text x="10" y="${barcode_height_px/2 + 3}" font-family="monospace" font-size="9" fill="#999">[No Barcode Value]</text>`;
                            }
                        } catch (e) {
                            console.error("Barcode rendering error:", e);
                        }
                    }
                }
            });
        });
    }
};

window.TSCPrinter = TSCPrinter;
