frappe.listview_settings['Barcode Print Log'] = {
    onload: function(listview) {
        // Automatically default filter to Today if no filters are present
        if (!listview.filter_area.get_filters().length) {
            listview.filter_area.add_filter('Barcode Print Log', 'print_datetime', 'Timespan', 'today');
        }
    }
};
