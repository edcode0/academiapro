'use strict';

const { google } = require('googleapis');

function makeOAuth2Client() {
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        (process.env.BASE_URL || '') + '/api/gmail/callback'
    );
}

async function createCalendarEvent(teacher, slot) {
    try {
        if (!teacher.calendar_access_token) return null;
        const auth = makeOAuth2Client();
        auth.setCredentials({
            access_token:  teacher.calendar_access_token,
            refresh_token: teacher.calendar_refresh_token,
            expiry_date:   teacher.calendar_token_expiry
        });
        const calendar = google.calendar({ version: 'v3', auth });
        const event = {
            summary:     `Clase - ${slot.student_name || 'Alumno'}`,
            description: 'Clase programada en AcademiaPro',
            start:       { dateTime: new Date(slot.start_datetime).toISOString(), timeZone: 'Europe/Madrid' },
            end:         { dateTime: new Date(slot.end_datetime).toISOString(),   timeZone: 'Europe/Madrid' },
            conferenceData: {
                createRequest: {
                    requestId:            `academiapro-${Date.now()}`,
                    conferenceSolutionKey: { type: 'hangoutsMeet' }
                }
            },
            attendees: slot.student_email ? [{ email: slot.student_email }] : []
        };
        const response = await calendar.events.insert({
            calendarId:            'primary',
            resource:              event,
            conferenceDataVersion: 1,
            sendUpdates:           'all'
        });
        const meetLink = response.data.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri;
        console.log('[Calendar] Event created:', response.data.id, 'Meet:', meetLink);
        return { google_event_id: response.data.id, meet_link: meetLink || null };
    } catch (err) {
        console.error('[Calendar] createCalendarEvent error:', err.message);
        return null;
    }
}

async function deleteCalendarEvent(teacher, googleEventId) {
    try {
        if (!teacher.calendar_access_token || !googleEventId) return;
        const auth = makeOAuth2Client();
        auth.setCredentials({
            access_token:  teacher.calendar_access_token,
            refresh_token: teacher.calendar_refresh_token
        });
        const calendar = google.calendar({ version: 'v3', auth });
        await calendar.events.delete({ calendarId: 'primary', eventId: googleEventId });
        console.log('[Calendar] Event deleted:', googleEventId);
    } catch (err) {
        console.error('[Calendar] deleteCalendarEvent error:', err.message);
    }
}

module.exports = { makeOAuth2Client, createCalendarEvent, deleteCalendarEvent };
